import type { SupabaseClient } from '@supabase/supabase-js'

const SUMMARY_INTERVAL = 6
const CHUNK_SIZE = 1500
const MAX_SUMMARY_LENGTH = 2000

interface MessageRow {
  id: string
  role: string
  content: string
  attachments?: any[]
  created_at: string
}

export async function shouldUpdateSummary(
  db: SupabaseClient,
  conversationId: string,
  userId: string
): Promise<boolean> {
  try {
    const { count } = await db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)

    const { data: conv } = await db
      .from('conversations')
      .select('last_context_refresh_at, message_count')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single()

    const currentCount = count || 0
    const lastCount = conv?.message_count || 0

    return currentCount - lastCount >= SUMMARY_INTERVAL
  } catch {
    return false
  }
}

export async function updateConversationSummary(
  db: SupabaseClient,
  conversationId: string,
  userId: string,
  latestAssistantContent: string
): Promise<void> {
  try {
    const { data: messages } = await db
      .from('messages')
      .select('id, role, content, attachments, created_at')
      .eq('conversation_id', conversationId)
      .order('order_index', { ascending: true })
      .limit(100)

    if (!messages || messages.length < 4) return

    const { data: conv } = await db
      .from('conversations')
      .select('rolling_summary, purpose_summary')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single()

    const rollingSummary = buildRollingSummary(
      messages as MessageRow[],
      conv?.rolling_summary || null
    )

    const purposeSummary = conv?.purpose_summary || derivePurpose(messages as MessageRow[])

    const updatePayload: Record<string, any> = {
      rolling_summary: rollingSummary.substring(0, MAX_SUMMARY_LENGTH),
      last_context_refresh_at: new Date().toISOString(),
      message_count: messages.length,
    }

    if (purposeSummary && !conv?.purpose_summary) {
      updatePayload.purpose_summary = purposeSummary.substring(0, 500)
    }

    await db
      .from('conversations')
      .update(updatePayload)
      .eq('id', conversationId)
      .eq('user_id', userId)

    // Also extract and save conversation memories
    await extractConversationMemories(db, conversationId, userId, messages as MessageRow[], latestAssistantContent)

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Summary] Updated conversation summary:', {
        conversationId,
        summaryLength: rollingSummary.length,
        messageCount: messages.length,
      })
    }
  } catch (e: any) {
    console.error('[Summary] Failed to update:', e.message)
  }
}

function buildRollingSummary(messages: MessageRow[], existingSummary: string | null): string {
  const parts: string[] = []

  if (existingSummary) {
    parts.push(`Previous context: ${existingSummary.substring(0, 800)}`)
  }

  // Summarize key exchanges
  const recentExchanges = messages.slice(-20)
  const keyPoints: string[] = []

  for (let i = 0; i < recentExchanges.length; i++) {
    const msg = recentExchanges[i]
    if (!msg.content || msg.content.length < 10) continue

    if (msg.role === 'user') {
      const summary = summarizeMessage(msg.content, 150)
      if (summary) keyPoints.push(`User asked: ${summary}`)

      // Note attachments
      if (msg.attachments && msg.attachments.length > 0) {
        const attNames = msg.attachments
          .map((a: any) => a.name || a.type || 'file')
          .join(', ')
        keyPoints.push(`User uploaded: ${attNames}`)
      }
    } else if (msg.role === 'assistant') {
      const summary = summarizeMessage(msg.content, 200)
      if (summary) keyPoints.push(`AI answered: ${summary}`)
    }
  }

  if (keyPoints.length > 0) {
    parts.push('Recent exchange:\n' + keyPoints.slice(-10).join('\n'))
  }

  // Check for unresolved tasks
  const lastUserMsg = recentExchanges.filter(m => m.role === 'user').pop()
  if (lastUserMsg) {
    const content = lastUserMsg.content.toLowerCase()
    if (content.includes('fix') || content.includes('help') || content.includes('continue') ||
        content.includes('finish') || content.includes('complete')) {
      parts.push(`Current task: ${summarizeMessage(lastUserMsg.content, 100)}`)
    }
  }

  return parts.join('\n\n')
}

function derivePurpose(messages: MessageRow[]): string | null {
  const firstUserMsgs = messages.filter(m => m.role === 'user').slice(0, 3)
  if (firstUserMsgs.length === 0) return null

  const combined = firstUserMsgs.map(m => m.content).join(' ')
  return summarizeMessage(combined, 200)
}

function summarizeMessage(content: string, maxLen: number): string {
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

async function extractConversationMemories(
  db: SupabaseClient,
  conversationId: string,
  userId: string,
  messages: MessageRow[],
  latestContent: string
): Promise<void> {
  try {
    // Check how many memories we already have for this conversation
    const { count } = await db
      .from('conversation_memories')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)

    if ((count || 0) >= 30) return // cap per conversation

    const newMemories: Array<{ title: string; content: string; scope: string; importance: number }> = []

    // Extract from recent messages
    const recentUser = messages.filter(m => m.role === 'user').slice(-3)
    for (const msg of recentUser) {
      // Detect instructions
      if (/\b(remember|always|never|my .+ is|i want|use .+ for)\b/i.test(msg.content)) {
        newMemories.push({
          title: 'User instruction',
          content: summarizeMessage(msg.content, 250),
          scope: 'conversation',
          importance: 4,
        })
      }

      // Detect task/decisions
      if (/\b(fix|build|create|implement|deploy|migrate|refactor|resolve)\b/i.test(msg.content)) {
        newMemories.push({
          title: 'Task',
          content: summarizeMessage(msg.content, 200),
          scope: 'task',
          importance: 3,
        })
      }

      // Detect attachments context
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          const name = att.name || 'unknown file'
          const textPreview = att.textContent ? summarizeMessage(att.textContent, 200) : ''
          newMemories.push({
            title: `Uploaded: ${name}`,
            content: textPreview || `User uploaded ${att.type || 'file'}: ${name}`,
            scope: 'attachment',
            importance: 3,
          })
        }
      }
    }

    // Detect decisions from assistant response
    if (latestContent && latestContent.length > 50) {
      const conclusionMatch = latestContent.match(/(?:in conclusion|therefore|the answer is|to summarize|key point)[:\s](.{20,200})/i)
      if (conclusionMatch) {
        newMemories.push({
          title: 'Conclusion reached',
          content: conclusionMatch[1].trim(),
          scope: 'decision',
          importance: 3,
        })
      }
    }

    // Save new memories (dedupe by checking existing)
    if (newMemories.length > 0) {
      const { data: existing } = await db
        .from('conversation_memories')
        .select('content')
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)

      const existingContents = new Set((existing || []).map(e => e.content.substring(0, 50)))

      const toInsert = newMemories.filter(mem =>
        !existingContents.has(mem.content.substring(0, 50))
      )

      if (toInsert.length > 0) {
        await db.from('conversation_memories').insert(
          toInsert.map(mem => ({
            user_id: userId,
            conversation_id: conversationId,
            scope: mem.scope,
            title: mem.title,
            content: mem.content,
            importance: mem.importance,
          }))
        )
      }
    }
  } catch (e: any) {
    console.error('[Summary] Memory extraction failed:', e.message)
  }
}

export async function chunkLongMessage(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
  messageId: string,
  content: string,
  sourceType: 'message' | 'attachment' = 'message'
): Promise<void> {
  if (!content || content.length < CHUNK_SIZE) return

  try {
    const chunks: Array<{ content: string; summary: string; chunk_index: number }> = []

    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
      const chunk = content.substring(i, i + CHUNK_SIZE)
      const summary = summarizeMessage(chunk, 150)
      chunks.push({ content: chunk, summary, chunk_index: Math.floor(i / CHUNK_SIZE) })
    }

    if (chunks.length > 20) return // don't chunk absurdly long content

    await db.from('memory_chunks').insert(
      chunks.map(c => ({
        user_id: userId,
        conversation_id: conversationId,
        source_type: sourceType,
        source_id: messageId,
        chunk_index: c.chunk_index,
        content: c.content,
        summary: c.summary,
      }))
    )

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Chunker] Saved', chunks.length, 'chunks for message', messageId)
    }
  } catch (e: any) {
    console.error('[Chunker] Failed:', e.message)
  }
}

export async function saveAttachmentMemory(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
  messageId: string,
  attachment: {
    name: string
    type: string
    mimeType?: string
    textContent?: string
    dataUrl?: string
  }
): Promise<void> {
  try {
    const extractedText = attachment.textContent || null
    const isImage = attachment.type === 'image'

    const attRow: Record<string, any> = {
      user_id: userId,
      conversation_id: conversationId,
      message_id: messageId,
      file_name: attachment.name || 'unknown',
      file_type: attachment.type || 'document',
      mime_type: attachment.mimeType || null,
      extracted_text: extractedText ? extractedText.substring(0, 10000) : null,
    }

    if (isImage && attachment.name) {
      attRow.vision_summary = `Image uploaded: ${attachment.name}`
      attRow.purpose_note = `User shared image "${attachment.name}" in conversation`
    } else if (extractedText) {
      attRow.purpose_note = `User uploaded document "${attachment.name}" containing ${extractedText.length} characters`
      const preview = extractedText.substring(0, 500)
      attRow.important_details = { preview, totalLength: extractedText.length }
    }

    await db.from('attachments').insert(attRow)

    // Chunk long text content
    if (extractedText && extractedText.length > CHUNK_SIZE) {
      await chunkLongMessage(db, userId, conversationId, messageId, extractedText, 'attachment')
    }

    // Create conversation memory about this upload
    const memContent = isImage
      ? `Image uploaded: ${attachment.name}`
      : `Document "${attachment.name}" uploaded${extractedText ? ` (${extractedText.length} chars)` : ''}`

    await db.from('conversation_memories').insert({
      user_id: userId,
      conversation_id: conversationId,
      scope: 'attachment',
      title: `File: ${attachment.name}`,
      content: memContent,
      importance: 3,
      source_message_id: messageId,
    })
  } catch (e: any) {
    // Non-fatal: table may not exist yet
    if (process.env.NODE_ENV !== 'production') {
      console.log('[AttachmentMemory] Save skipped:', e.message)
    }
  }
}
