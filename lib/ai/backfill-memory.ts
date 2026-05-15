import type { SupabaseClient } from '@supabase/supabase-js'

const BACKFILL_VERSION = 1
const CHUNK_SIZE = 1500
const MAX_MEMORIES_PER_CONVERSATION = 30
const BATCH_SIZE = 5

export interface BackfillOptions {
  userId?: string
  conversationId?: string
  dryRun?: boolean
  limit?: number
  force?: boolean
}

export interface BackfillProgress {
  totalConversations: number
  processed: number
  skipped: number
  errors: number
  memoriesCreated: number
  chunksCreated: number
  attachmentsProcessed: number
  summariesGenerated: number
  logs: string[]
}

interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  attachments?: any[]
  created_at: string
  order_index?: number
}

interface ConversationRow {
  id: string
  user_id: string
  title: string
  rolling_summary: string | null
  purpose_summary: string | null
  last_context_refresh_at: string | null
  message_count: number | null
  created_at: string
}

function log(progress: BackfillProgress, msg: string) {
  progress.logs.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Backfill]', msg)
  }
}

function summarizeText(content: string, maxLen: number): string {
  if (!content) return ''
  let text = content
    .replace(/```[\s\S]*?```/g, '[code block]')
    .replace(/\n{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length > maxLen) {
    text = text.substring(0, maxLen)
    const lastSpace = text.lastIndexOf(' ')
    if (lastSpace > maxLen * 0.5) text = text.substring(0, lastSpace)
    text += '...'
  }
  return text
}

function extractKeyPoints(messages: MessageRow[]): {
  purpose: string
  summary: string
  tasks: string[]
  decisions: string[]
  uploads: string[]
} {
  const userMessages = messages.filter(m => m.role === 'user')
  const assistantMessages = messages.filter(m => m.role === 'assistant')

  // Derive purpose from first few user messages
  const firstUserMsgs = userMessages.slice(0, 3)
  const purpose = firstUserMsgs.length > 0
    ? summarizeText(firstUserMsgs.map(m => m.content).join(' '), 300)
    : ''

  // Build rolling summary from key exchanges
  const keyExchanges: string[] = []
  for (let i = 0; i < Math.min(messages.length, 30); i++) {
    const msg = messages[i]
    if (!msg.content || msg.content.length < 10) continue

    if (msg.role === 'user') {
      keyExchanges.push(`User: ${summarizeText(msg.content, 120)}`)
    } else if (msg.role === 'assistant' && msg.content.length > 50) {
      keyExchanges.push(`AI: ${summarizeText(msg.content, 150)}`)
    }
  }

  const summary = keyExchanges.slice(0, 12).join('\n')

  // Extract tasks
  const tasks: string[] = []
  for (const msg of userMessages) {
    if (/\b(fix|build|create|implement|deploy|migrate|refactor|resolve|help me|finish|complete)\b/i.test(msg.content)) {
      tasks.push(summarizeText(msg.content, 150))
    }
  }

  // Extract decisions from assistant responses
  const decisions: string[] = []
  for (const msg of assistantMessages) {
    const match = msg.content.match(/(?:in conclusion|therefore|the answer is|to summarize|key point|recommendation)[:\s](.{20,200})/i)
    if (match) {
      decisions.push(match[1].trim())
    }
  }

  // Extract uploads
  const uploads: string[] = []
  for (const msg of userMessages) {
    if (msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments) {
        const name = att.name || att.type || 'file'
        const textPreview = att.textContent ? summarizeText(att.textContent, 100) : ''
        uploads.push(textPreview ? `${name}: ${textPreview}` : name)
      }
    }
  }

  return { purpose, summary, tasks: tasks.slice(0, 5), decisions: decisions.slice(0, 5), uploads: uploads.slice(0, 10) }
}

async function processConversation(
  db: SupabaseClient,
  conversation: ConversationRow,
  options: BackfillOptions,
  progress: BackfillProgress
): Promise<void> {
  const { id: conversationId, user_id: userId } = conversation

  // Skip if already processed (unless force)
  if (!options.force && conversation.last_context_refresh_at && conversation.rolling_summary) {
    progress.skipped++
    log(progress, `Skipped ${conversationId} (already processed)`)
    return
  }

  // Load all messages
  const { data: messages, error: msgErr } = await db
    .from('messages')
    .select('id, conversation_id, role, content, attachments, created_at, order_index')
    .eq('conversation_id', conversationId)
    .order('order_index', { ascending: true })
    .limit(200)

  if (msgErr || !messages || messages.length < 2) {
    if (messages && messages.length < 2) {
      progress.skipped++
      log(progress, `Skipped ${conversationId} (< 2 messages)`)
    } else {
      progress.errors++
      log(progress, `Error loading ${conversationId}: ${msgErr?.message}`)
    }
    return
  }

  // Filter out loading markers
  const validMessages = messages.filter((m: any) =>
    m.content &&
    m.content !== '__ARTIFACT_LOADING__' &&
    m.content !== '__ASSISTANT_LOADING__' &&
    m.content !== '__LONG_TASK_LOADING__' &&
    m.content !== '__RECOVERY_POLLING__' &&
    m.content.trim() !== '...' &&
    m.content.trim().length > 0
  ) as MessageRow[]

  if (validMessages.length < 2) {
    progress.skipped++
    return
  }

  const keyPoints = extractKeyPoints(validMessages)

  if (options.dryRun) {
    log(progress, `[DRY RUN] Would process ${conversationId}: ${validMessages.length} msgs, purpose="${keyPoints.purpose.substring(0, 60)}"`)
    progress.processed++
    return
  }

  // 1. Update conversation summaries
  const updatePayload: Record<string, any> = {
    last_context_refresh_at: new Date().toISOString(),
    message_count: validMessages.length,
  }

  if (!conversation.purpose_summary && keyPoints.purpose) {
    updatePayload.purpose_summary = keyPoints.purpose.substring(0, 500)
  }

  if (!conversation.rolling_summary || options.force) {
    updatePayload.rolling_summary = keyPoints.summary.substring(0, 2000)
  }

  await db
    .from('conversations')
    .update(updatePayload)
    .eq('id', conversationId)
    .eq('user_id', userId)

  progress.summariesGenerated++

  // 2. Create conversation memories (deduplicated)
  const { data: existingMemories } = await db
    .from('conversation_memories')
    .select('content, source_message_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)

  const existingContents = new Set((existingMemories || []).map(m => m.content.substring(0, 50)))
  const existingSourceIds = new Set((existingMemories || []).map(m => m.source_message_id).filter(Boolean))

  const memoriesToInsert: Array<Record<string, any>> = []

  // Tasks
  for (const task of keyPoints.tasks) {
    if (existingContents.has(task.substring(0, 50))) continue
    if (memoriesToInsert.length >= MAX_MEMORIES_PER_CONVERSATION) break
    memoriesToInsert.push({
      user_id: userId,
      conversation_id: conversationId,
      scope: 'task',
      title: 'Task',
      content: task,
      importance: 3,
      metadata: { backfill_version: BACKFILL_VERSION },
    })
  }

  // Decisions
  for (const decision of keyPoints.decisions) {
    if (existingContents.has(decision.substring(0, 50))) continue
    if (memoriesToInsert.length >= MAX_MEMORIES_PER_CONVERSATION) break
    memoriesToInsert.push({
      user_id: userId,
      conversation_id: conversationId,
      scope: 'decision',
      title: 'Decision/Conclusion',
      content: decision,
      importance: 3,
      metadata: { backfill_version: BACKFILL_VERSION },
    })
  }

  // User instructions/preferences in this chat
  for (const msg of validMessages.filter(m => m.role === 'user')) {
    if (/\b(remember|always|never|my .+ is|i want|i prefer|from now on)\b/i.test(msg.content)) {
      const memContent = summarizeText(msg.content, 250)
      if (existingContents.has(memContent.substring(0, 50))) continue
      if (existingSourceIds.has(msg.id)) continue
      if (memoriesToInsert.length >= MAX_MEMORIES_PER_CONVERSATION) break
      memoriesToInsert.push({
        user_id: userId,
        conversation_id: conversationId,
        scope: 'preference',
        title: 'User instruction',
        content: memContent,
        importance: 4,
        source_message_id: msg.id,
        metadata: { backfill_version: BACKFILL_VERSION },
      })
    }
  }

  // Upload memories
  for (const upload of keyPoints.uploads) {
    if (existingContents.has(upload.substring(0, 50))) continue
    if (memoriesToInsert.length >= MAX_MEMORIES_PER_CONVERSATION) break
    memoriesToInsert.push({
      user_id: userId,
      conversation_id: conversationId,
      scope: 'attachment',
      title: 'File uploaded',
      content: upload,
      importance: 3,
      metadata: { backfill_version: BACKFILL_VERSION },
    })
  }

  if (memoriesToInsert.length > 0) {
    const { error: memInsertErr } = await db
      .from('conversation_memories')
      .insert(memoriesToInsert)

    if (memInsertErr) {
      log(progress, `Memory insert error for ${conversationId}: ${memInsertErr.message}`)
    } else {
      progress.memoriesCreated += memoriesToInsert.length
    }
  }

  // 3. Chunk long messages
  const { data: existingChunks } = await db
    .from('memory_chunks')
    .select('source_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)

  const chunkedSourceIds = new Set((existingChunks || []).map(c => c.source_id))

  const chunksToInsert: Array<Record<string, any>> = []

  for (const msg of validMessages) {
    if (msg.content.length < CHUNK_SIZE) continue
    if (chunkedSourceIds.has(msg.id)) continue

    for (let i = 0; i < msg.content.length && i < CHUNK_SIZE * 20; i += CHUNK_SIZE) {
      const chunk = msg.content.substring(i, i + CHUNK_SIZE)
      chunksToInsert.push({
        user_id: userId,
        conversation_id: conversationId,
        source_type: 'message',
        source_id: msg.id,
        chunk_index: Math.floor(i / CHUNK_SIZE),
        content: chunk,
        summary: summarizeText(chunk, 150),
        metadata: { backfill_version: BACKFILL_VERSION, role: msg.role },
      })
    }
  }

  if (chunksToInsert.length > 0) {
    // Insert in batches to avoid payload limits
    for (let i = 0; i < chunksToInsert.length; i += 20) {
      const batch = chunksToInsert.slice(i, i + 20)
      const { error: chunkErr } = await db.from('memory_chunks').insert(batch)
      if (chunkErr) {
        log(progress, `Chunk insert error for ${conversationId}: ${chunkErr.message}`)
        break
      }
    }
    progress.chunksCreated += chunksToInsert.length
  }

  // 4. Process attachments
  for (const msg of validMessages) {
    if (!msg.attachments || msg.attachments.length === 0) continue

    for (const att of msg.attachments) {
      // Check if attachment already exists
      const { data: existingAtt } = await db
        .from('attachments')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('message_id', msg.id)
        .eq('file_name', att.name || 'unknown')
        .limit(1)

      if (existingAtt && existingAtt.length > 0) continue

      const attRow: Record<string, any> = {
        user_id: userId,
        conversation_id: conversationId,
        message_id: msg.id,
        file_name: att.name || 'unknown',
        file_type: att.type || 'document',
        mime_type: att.mimeType || null,
        extracted_text: null,
        vision_summary: null,
        purpose_note: null,
        important_details: {},
      }

      if (att.type === 'image') {
        // For images: check if we have dataUrl stored or any context
        if (att.dataUrl) {
          attRow.vision_summary = `Image "${att.name}" uploaded by user`
          attRow.purpose_note = `User shared image in conversation`
        } else {
          // No raw image available - try to infer from surrounding context
          const nearbyAssistant = validMessages.find(m =>
            m.role === 'assistant' &&
            new Date(m.created_at).getTime() > new Date(msg.created_at).getTime() &&
            new Date(m.created_at).getTime() - new Date(msg.created_at).getTime() < 300000
          )

          if (nearbyAssistant && nearbyAssistant.content.length > 50) {
            const inferredContext = summarizeText(nearbyAssistant.content, 300)
            attRow.vision_summary = `Image "${att.name}" - AI's response suggests: ${inferredContext}`
            attRow.important_details = { source_confidence: 'low', inferred_from: 'assistant_response' }
          } else {
            attRow.vision_summary = `Image "${att.name}" was shared (original not available)`
            attRow.important_details = { source_confidence: 'low', original_unavailable: true }
          }
          attRow.purpose_note = `Image uploaded but original not retained in message data`
        }
      } else if (att.type === 'document') {
        // For documents: use textContent if available
        if (att.textContent) {
          attRow.extracted_text = att.textContent.substring(0, 10000)
          attRow.purpose_note = `Document "${att.name}" (${att.textContent.length} chars extracted)`
          attRow.important_details = {
            preview: att.textContent.substring(0, 500),
            totalLength: att.textContent.length,
          }

          // Chunk long document text
          if (att.textContent.length > CHUNK_SIZE && !chunkedSourceIds.has(msg.id + ':' + att.name)) {
            const docChunks: Array<Record<string, any>> = []
            for (let i = 0; i < att.textContent.length && i < CHUNK_SIZE * 20; i += CHUNK_SIZE) {
              docChunks.push({
                user_id: userId,
                conversation_id: conversationId,
                source_type: 'attachment',
                source_id: msg.id,
                chunk_index: Math.floor(i / CHUNK_SIZE),
                content: att.textContent.substring(i, i + CHUNK_SIZE),
                summary: summarizeText(att.textContent.substring(i, i + CHUNK_SIZE), 150),
                metadata: { backfill_version: BACKFILL_VERSION, file_name: att.name },
              })
            }
            if (docChunks.length > 0 && docChunks.length <= 20) {
              await db.from('memory_chunks').insert(docChunks)
              progress.chunksCreated += docChunks.length
            }
          }
        } else if (att.storagePath) {
          attRow.purpose_note = `Document "${att.name}" stored at ${att.storagePath} (text not yet extracted)`
          attRow.important_details = { storage_path: att.storagePath, needs_reprocessing: true }
        } else {
          attRow.purpose_note = `Document "${att.name}" was uploaded (content not available)`
          attRow.important_details = { source_confidence: 'low', original_unavailable: true }
        }
      }

      const { error: attInsertErr } = await db.from('attachments').insert(attRow)
      if (!attInsertErr) {
        progress.attachmentsProcessed++
      }
    }
  }

  // 5. Create context snapshot
  const { data: existingSnapshot } = await db
    .from('context_snapshots')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .limit(1)

  if (!existingSnapshot || existingSnapshot.length === 0) {
    await db.from('context_snapshots').insert({
      user_id: userId,
      conversation_id: conversationId,
      summary: keyPoints.summary.substring(0, 2000),
      key_decisions: keyPoints.decisions,
      open_tasks: keyPoints.tasks,
      important_files: keyPoints.uploads,
      current_errors: [],
    })
  }

  progress.processed++
  log(progress, `Processed ${conversationId}: ${validMessages.length} msgs, ${memoriesToInsert.length} memories, ${chunksToInsert.length} chunks`)
}

export async function runBackfill(
  db: SupabaseClient,
  options: BackfillOptions
): Promise<BackfillProgress> {
  const progress: BackfillProgress = {
    totalConversations: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    memoriesCreated: 0,
    chunksCreated: 0,
    attachmentsProcessed: 0,
    summariesGenerated: 0,
    logs: [],
  }

  log(progress, `Starting backfill: ${JSON.stringify({ ...options, dryRun: options.dryRun ?? false })}`)

  try {
    // Build query
    let query = db
      .from('conversations')
      .select('id, user_id, title, rolling_summary, purpose_summary, last_context_refresh_at, message_count, created_at')
      .order('updated_at', { ascending: false })

    if (options.conversationId) {
      query = query.eq('id', options.conversationId)
    } else if (options.userId) {
      query = query.eq('user_id', options.userId)
    }

    if (options.limit) {
      query = query.limit(options.limit)
    } else {
      query = query.limit(500)
    }

    const { data: conversations, error: convErr } = await query

    if (convErr) {
      log(progress, `Failed to load conversations: ${convErr.message}`)
      progress.errors++
      return progress
    }

    if (!conversations || conversations.length === 0) {
      log(progress, 'No conversations found')
      return progress
    }

    progress.totalConversations = conversations.length
    log(progress, `Found ${conversations.length} conversations to process`)

    // Process in batches
    for (let i = 0; i < conversations.length; i += BATCH_SIZE) {
      const batch = conversations.slice(i, i + BATCH_SIZE)

      for (const conv of batch) {
        try {
          await processConversation(db, conv as ConversationRow, options, progress)
        } catch (e: any) {
          progress.errors++
          log(progress, `Error processing ${conv.id}: ${e.message}`)
        }
      }

      // Log batch progress
      if (conversations.length > BATCH_SIZE) {
        log(progress, `Batch progress: ${Math.min(i + BATCH_SIZE, conversations.length)}/${conversations.length}`)
      }
    }

    log(progress, `Backfill complete: ${progress.processed} processed, ${progress.skipped} skipped, ${progress.errors} errors`)
    log(progress, `Created: ${progress.memoriesCreated} memories, ${progress.chunksCreated} chunks, ${progress.attachmentsProcessed} attachments, ${progress.summariesGenerated} summaries`)
  } catch (e: any) {
    log(progress, `Fatal error: ${e.message}`)
    progress.errors++
  }

  return progress
}
