import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from '@/types/models'
import type { ChatAttachment } from '@/types/models'
import { extractTextFromAttachment } from '@/lib/ai/document-extract'
import { saveAttachmentMemory } from '@/lib/ai/conversation-summary'

export interface ContextBuildOptions {
  userId: string
  conversationId: string
  latestUserMessage: string
  modelProvider: string
  maxTokenBudget?: number
  currentMessages: ChatMessage[]
  includeUserMemories?: boolean
}

export interface BuiltContext {
  recentMessages: ChatMessage[]
  conversationSummary: string | null
  attachmentSummaries: string[]
  userMemories: string[]
  conversationMemories: string[]
  relevantChunks: string[]
  crossConversationContext: string[]
  debugInfo: {
    recentMessagesCount: number
    memoriesCount: number
    chunksCount: number
    attachmentSummariesCount: number
    historicalAttachmentsLoadedCount: number
    attachmentChunksLoadedCount: number
    attachmentExtractedTextLength: number
    previousPdfContextInjected: boolean
    fileNamesIncluded: string[]
    crossConversationCount: number
    estimatedTokens: number
    provider: string
  }
}

const APPROX_CHARS_PER_TOKEN = 4
const DEFAULT_TOKEN_BUDGET = 24000
const DEFAULT_ATTACHMENT_CONTEXT_CHARS = 1200
const FOLLOW_UP_ATTACHMENT_CONTEXT_CHARS = 12000

interface HistoricalAttachment {
  id?: string
  messageId?: string
  fileName: string
  fileType: string
  mimeType?: string | null
  extractedText?: string | null
  visionSummary?: string | null
  ocrText?: string | null
  importantDetails?: Record<string, any> | null
  purposeNote?: string | null
  storageProvider?: string | null
  storageKey?: string | null
  storagePath?: string | null
  bucket?: string | null
  createdAt?: string | null
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN)
}

function extractSearchKeywords(message: string): string[] {
  const lower = message.toLowerCase()
  const words = lower.split(/\s+/).filter(w => w.length > 2)

  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
    'was', 'one', 'our', 'out', 'has', 'had', 'his', 'how', 'its', 'may',
    'who', 'did', 'get', 'has', 'him', 'let', 'say', 'she', 'too', 'use',
    'what', 'know', 'about', 'that', 'this', 'with', 'have', 'from', 'they',
    'been', 'will', 'more', 'when', 'some', 'them', 'than', 'very', 'your',
    'tell', 'remember', 'anything', 'something', 'could', 'would', 'should',
    'does', 'there',
  ])

  const filtered = words.filter(w => !stopWords.has(w) && w.length > 2)

  const bigrams: string[] = []
  for (let i = 0; i < words.length - 1; i++) {
    if (!stopWords.has(words[i]) || !stopWords.has(words[i + 1])) {
      bigrams.push(`${words[i]} ${words[i + 1]}`)
    }
  }

  return [...filtered, ...bigrams].slice(0, 10)
}

export function isDocumentFollowUpRequest(message: string): boolean {
  return /\b(q(?:uestion)?\s*\d+|question\s+(?:one|two|three|four|five|six|seven|eight|nine|ten)|next\s+question|previous\s+question|the\s+(?:pdf|document|file|worksheet|attachment)|uploaded\s+(?:pdf|document|file)|what\s+(?:pdf|document|file)\s+did\s+i\s+upload|continue|do\s+(?:q|question)|solve\s+(?:q|question))\b/i.test(message)
}

function getAttachmentField(att: any, camel: string, snake?: string): any {
  return att?.[camel] ?? (snake ? att?.[snake] : undefined)
}

function attachmentStorageDetails(att: any): {
  storageProvider?: string | null
  storageKey?: string | null
  storagePath?: string | null
  bucket?: string | null
} {
  const importantDetails = att?.important_details || att?.importantDetails || {}
  const storageProvider =
    getAttachmentField(att, 'storageProvider', 'storage_provider') ||
    importantDetails.storageProvider ||
    importantDetails.storage_provider ||
    (getAttachmentField(att, 'storageKey', 'storage_key') || getAttachmentField(att, 'storagePath', 'storage_path') ? 'r2' : null)
  const storageKey =
    getAttachmentField(att, 'storageKey', 'storage_key') ||
    importantDetails.storageKey ||
    importantDetails.storage_key ||
    getAttachmentField(att, 'storagePath', 'storage_path') ||
    importantDetails.storagePath ||
    importantDetails.storage_path ||
    null
  const storagePath =
    getAttachmentField(att, 'storagePath', 'storage_path') ||
    importantDetails.storagePath ||
    importantDetails.storage_path ||
    storageKey ||
    null
  const bucket = getAttachmentField(att, 'bucket', 'storage_bucket') || importantDetails.bucket || null

  return { storageProvider, storageKey, storagePath, bucket }
}

function addHistoricalAttachment(
  attachments: HistoricalAttachment[],
  seen: Set<string>,
  attachment: HistoricalAttachment
) {
  const key = `${attachment.messageId || 'none'}:${attachment.fileName}:${attachment.storageKey || attachment.storagePath || 'inline'}`
  const existingIndex = attachments.findIndex((att) => {
    const existingKey = `${att.messageId || 'none'}:${att.fileName}:${att.storageKey || att.storagePath || 'inline'}`
    return existingKey === key
  })

  if (existingIndex >= 0) {
    const existing = attachments[existingIndex]
    attachments[existingIndex] = {
      ...existing,
      ...attachment,
      extractedText: attachment.extractedText || existing.extractedText,
      id: attachment.id || existing.id,
      messageId: attachment.messageId || existing.messageId,
    }
    return
  }

  if (seen.has(key)) return
  seen.add(key)
  attachments.push(attachment)
}

async function loadHistoricalAttachments(
  db: SupabaseClient,
  userId: string,
  conversationId: string
): Promise<HistoricalAttachment[]> {
  const attachments: HistoricalAttachment[] = []
  const seen = new Set<string>()

  try {
    const { data: attachmentRows } = await db
      .from('attachments')
      .select('id, message_id, file_name, file_type, mime_type, storage_path, public_url, extracted_text, vision_summary, ocr_text, important_details, purpose_note, created_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)

    for (const row of attachmentRows || []) {
      const details = attachmentStorageDetails(row)
      addHistoricalAttachment(attachments, seen, {
        id: row.id,
        messageId: row.message_id,
        fileName: row.file_name || 'unknown',
        fileType: row.file_type || 'document',
        mimeType: row.mime_type,
        extractedText: row.extracted_text,
        visionSummary: row.vision_summary,
        ocrText: row.ocr_text,
        importantDetails: row.important_details || {},
        purposeNote: row.purpose_note,
        storageProvider: details.storageProvider,
        storageKey: details.storageKey,
        storagePath: details.storagePath,
        bucket: details.bucket,
        createdAt: row.created_at,
      })
    }
  } catch (e: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ContextBuilder] Attachment table fetch skipped:', e.message)
    }
  }

  try {
    const { data: messageRows } = await db
      .from('messages')
      .select('id, attachments, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(50)

    for (const msg of messageRows || []) {
      if (!Array.isArray(msg.attachments)) continue

      for (const rawAtt of msg.attachments) {
        const name = rawAtt?.name || rawAtt?.file_name || 'unknown'
        const type = rawAtt?.type || rawAtt?.file_type || 'document'
        const details = attachmentStorageDetails(rawAtt)
        addHistoricalAttachment(attachments, seen, {
          messageId: msg.id,
          fileName: name,
          fileType: type,
          mimeType: rawAtt?.mimeType || rawAtt?.mime_type || null,
          extractedText: rawAtt?.textContent || rawAtt?.extracted_text || null,
          storageProvider: details.storageProvider,
          storageKey: details.storageKey,
          storagePath: details.storagePath,
          bucket: details.bucket,
          createdAt: msg.created_at,
        })
      }
    }
  } catch (e: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ContextBuilder] Message attachment fetch skipped:', e.message)
    }
  }

  return attachments.sort((a, b) =>
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  )
}

function isRecoverableDocumentText(text: string): boolean {
  return !!text &&
    text !== '__MISSING_DATA__' &&
    text !== '__PDF_EXTRACTION_FAILED__' &&
    text !== '__PDF_NO_TEXT__'
}

async function recoverMissingR2Text(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
  attachment: HistoricalAttachment
): Promise<string | null> {
  const storageKey = attachment.storageKey || attachment.storagePath
  const provider = attachment.storageProvider || (storageKey ? 'r2' : null)
  if (provider !== 'r2' || !storageKey || attachment.fileType !== 'document') return null

  const recovered = await extractTextFromAttachment({
    type: 'document',
    name: attachment.fileName,
    mimeType: attachment.mimeType || 'application/pdf',
    storageProvider: 'r2',
    storageKey,
    storagePath: attachment.storagePath || storageKey,
    bucket: attachment.bucket || undefined,
  } as ChatAttachment)

  if (!isRecoverableDocumentText(recovered)) return null

  if (attachment.messageId) {
    await saveAttachmentMemory(db, userId, conversationId, attachment.messageId, {
      name: attachment.fileName,
      type: 'document',
      mimeType: attachment.mimeType || 'application/pdf',
      textContent: recovered,
      storageProvider: 'r2',
      storageKey,
      storagePath: attachment.storagePath || storageKey,
      bucket: attachment.bucket || undefined,
    })
  } else if (attachment.id) {
    await db
      .from('attachments')
      .update({
        extracted_text: recovered.substring(0, 10000),
        important_details: {
          ...(attachment.importantDetails || {}),
          totalLength: recovered.length,
          recoveredFromR2: true,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', attachment.id)
  }

  return recovered
}

export async function buildContext(
  db: SupabaseClient,
  options: ContextBuildOptions
): Promise<BuiltContext> {
  const {
    userId,
    conversationId,
    latestUserMessage,
    modelProvider,
    maxTokenBudget = DEFAULT_TOKEN_BUDGET,
    currentMessages,
    includeUserMemories = true,
  } = options

  const result: BuiltContext = {
    recentMessages: [],
    conversationSummary: null,
    attachmentSummaries: [],
    userMemories: [],
    conversationMemories: [],
    relevantChunks: [],
    crossConversationContext: [],
    debugInfo: {
      recentMessagesCount: 0,
      memoriesCount: 0,
      chunksCount: 0,
      attachmentSummariesCount: 0,
      historicalAttachmentsLoadedCount: 0,
      attachmentChunksLoadedCount: 0,
      attachmentExtractedTextLength: 0,
      previousPdfContextInjected: false,
      fileNamesIncluded: [],
      crossConversationCount: 0,
      estimatedTokens: 0,
      provider: modelProvider,
    },
  }

  let remainingBudget = maxTokenBudget
  const latestMsgTokens = estimateTokens(latestUserMessage)
  remainingBudget -= latestMsgTokens
  remainingBudget -= 2000 // reserve for system prompt

  // 1. Load conversation metadata (rolling summary, purpose)
  try {
    const { data: conv } = await db
      .from('conversations')
      .select('purpose_summary, rolling_summary, pinned_context')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single()

    if (conv) {
      const parts: string[] = []
      if (conv.purpose_summary) parts.push(`Chat purpose: ${conv.purpose_summary}`)
      if (conv.rolling_summary) parts.push(`Context so far: ${conv.rolling_summary}`)
      if (conv.pinned_context) parts.push(`Pinned: ${conv.pinned_context}`)

      if (parts.length > 0) {
        const summary = parts.join('\n\n')
        const summaryTokens = estimateTokens(summary)
        if (summaryTokens < remainingBudget * 0.3) {
          result.conversationSummary = summary
          remainingBudget -= summaryTokens
        }
      }
    }
  } catch (e: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ContextBuilder] Conv metadata fetch skipped:', e.message)
    }
  }

  // 2. Recent messages from current session (already provided by frontend, use up to 20)
  const recentCount = Math.min(currentMessages.length, 20)
  const recentSlice = currentMessages.slice(-recentCount)
  let recentTokens = 0
  const filteredRecent: ChatMessage[] = []

  for (const msg of recentSlice) {
    const msgTokens = estimateTokens(msg.content || '')
    if (recentTokens + msgTokens > remainingBudget * 0.5) break
    filteredRecent.push(msg)
    recentTokens += msgTokens
  }

  result.recentMessages = filteredRecent
  remainingBudget -= recentTokens
  result.debugInfo.recentMessagesCount = filteredRecent.length

  // 3. Load attachment context for this conversation, including message JSON
  // fallback so follow-ups do not depend on only the latest message payload.
  const documentFollowUp = isDocumentFollowUpRequest(latestUserMessage)
  let historicalAttachments: HistoricalAttachment[] = []

  try {
    historicalAttachments = await loadHistoricalAttachments(db, userId, conversationId)
    result.debugInfo.historicalAttachmentsLoadedCount = historicalAttachments.length

    if (historicalAttachments.length > 0) {
      for (const att of historicalAttachments.slice(0, 10)) {
        if (remainingBudget < 500) break

        let extractedText = att.extractedText || ''
        if (!extractedText && documentFollowUp && att.fileType === 'document') {
          const recovered = await recoverMissingR2Text(db, userId, conversationId, att)
          if (recovered) {
            extractedText = recovered
            att.extractedText = recovered
          }
        }

        if (extractedText) {
          result.debugInfo.attachmentExtractedTextLength += extractedText.length
        }

        let summary = ''
        if (att.purposeNote) summary += att.purposeNote + '\n'
        if (att.visionSummary) summary += `Visual: ${att.visionSummary}\n`
        if (att.ocrText) summary += `Text found: ${att.ocrText.substring(0, 500)}\n`
        if (extractedText && !att.ocrText) {
          const maxChars = documentFollowUp && att.fileType === 'document'
            ? FOLLOW_UP_ATTACHMENT_CONTEXT_CHARS
            : DEFAULT_ATTACHMENT_CONTEXT_CHARS
          summary += `Content: ${extractedText.substring(0, maxChars)}\n`
        }
        if (att.importantDetails && Object.keys(att.importantDetails).length > 0) {
          summary += `Details: ${JSON.stringify(att.importantDetails)}\n`
        }

        if (summary) {
          const label = `[Attached ${att.fileType || 'file'}: ${att.fileName}]\n${summary.trim()}`
          const tokens = estimateTokens(label)
          if (tokens < remainingBudget) {
            result.attachmentSummaries.push(label)
            result.debugInfo.fileNamesIncluded.push(att.fileName)
            remainingBudget -= tokens
          }
        }
      }

      result.debugInfo.attachmentSummariesCount = result.attachmentSummaries.length
      result.debugInfo.previousPdfContextInjected = documentFollowUp && historicalAttachments.some((att) =>
        result.debugInfo.fileNamesIncluded.includes(att.fileName) &&
        (att.fileName.toLowerCase().endsWith('.pdf') || att.mimeType === 'application/pdf')
      )
    }
  } catch (e: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ContextBuilder] Attachments fetch skipped:', e.message)
    }
  }

  // 4. Load conversation-scoped memories
  try {
    const { data: convMemories } = await db
      .from('conversation_memories')
      .select('title, content, scope, importance')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(15)

    if (convMemories && convMemories.length > 0) {
      for (const mem of convMemories) {
        if (remainingBudget < 200) break
        const entry = mem.title ? `${mem.title}: ${mem.content}` : mem.content
        const tokens = estimateTokens(entry)
        if (tokens < remainingBudget) {
          result.conversationMemories.push(entry)
          remainingBudget -= tokens
        }
      }
    }
  } catch (e: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ContextBuilder] Conv memories fetch skipped:', e.message)
    }
  }

  // 5. Load relevant memory chunks (keyword-match against latest message)
  // Search BOTH same-conversation and cross-conversation chunks
  const keywords = extractSearchKeywords(latestUserMessage)

  try {
    if (keywords.length > 0) {
      // First: same-conversation chunks
      const { data: sameConvChunks } = await db
        .from('memory_chunks')
        .select('id, content, summary, source_type, chunk_index, metadata, created_at')
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)

      // Second: cross-conversation chunks (different conversations, same user)
      const { data: crossConvChunks } = await db
        .from('memory_chunks')
        .select('id, content, summary, source_type, conversation_id')
        .eq('user_id', userId)
        .neq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(40)

      const includedChunkIds = new Set<string>()

      if (documentFollowUp && sameConvChunks && sameConvChunks.length > 0) {
        const attachmentChunks = sameConvChunks
          .filter(chunk => chunk.source_type === 'attachment')
          .sort((a, b) => {
            const fileA = a.metadata?.file_name || ''
            const fileB = b.metadata?.file_name || ''
            if (fileA !== fileB) return fileA.localeCompare(fileB)
            return (a.chunk_index || 0) - (b.chunk_index || 0)
          })
          .slice(0, 8)

        for (const chunk of attachmentChunks) {
          if (remainingBudget < 300) break
          const fileName = chunk.metadata?.file_name ? ` from ${chunk.metadata.file_name}` : ''
          const text = `[Document chunk${fileName}]\n${chunk.content.substring(0, 1400)}`
          const tokens = estimateTokens(text)
          if (tokens < remainingBudget) {
            result.relevantChunks.push(text)
            result.debugInfo.attachmentChunksLoadedCount++
            if (chunk.id) includedChunkIds.add(chunk.id)
            if (chunk.metadata?.file_name) result.debugInfo.fileNamesIncluded.push(chunk.metadata.file_name)
            remainingBudget -= tokens
          }
        }
      }

      const allChunks = [...(sameConvChunks || []), ...(crossConvChunks || [])]

      if (allChunks.length > 0) {
        const scored = allChunks
          .filter(chunk => !chunk.id || !includedChunkIds.has(chunk.id))
          .map(chunk => {
            const text = (chunk.summary || chunk.content).toLowerCase()
            let matchCount = 0
            for (const kw of keywords) {
              if (text.includes(kw)) matchCount++
            }
            return { chunk, score: matchCount }
          })
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)

        for (const { chunk } of scored) {
          if (remainingBudget < 300) break
          const text = chunk.summary || chunk.content.substring(0, 600)
          const tokens = estimateTokens(text)
          if (tokens < remainingBudget) {
            result.relevantChunks.push(text)
            remainingBudget -= tokens
          }
        }
        result.debugInfo.chunksCount = result.relevantChunks.length
      }
    }
  } catch (e: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ContextBuilder] Chunks fetch skipped:', e.message)
    }
  }

  // 6. Cross-conversation memory search
  // Search conversation_memories and conversation summaries from OTHER conversations
  try {
    if (keywords.length > 0 && remainingBudget > 1000) {
      // Search conversation_memories across ALL user conversations (not just current)
      const { data: crossMemories } = await db
        .from('conversation_memories')
        .select('title, content, scope, importance, conversation_id')
        .eq('user_id', userId)
        .neq('conversation_id', conversationId)
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50)

      if (crossMemories && crossMemories.length > 0) {
        const scored = crossMemories
          .map(mem => {
            const text = `${mem.title || ''} ${mem.content}`.toLowerCase()
            let matchCount = 0
            for (const kw of keywords) {
              if (text.includes(kw)) matchCount++
            }
            return { mem, score: matchCount + (mem.importance || 0) * 0.5 }
          })
          .filter(s => s.score > 1)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)

        for (const { mem } of scored) {
          if (remainingBudget < 200) break
          const entry = mem.title ? `${mem.title}: ${mem.content}` : mem.content
          const tokens = estimateTokens(entry)
          if (tokens < remainingBudget) {
            result.crossConversationContext.push(entry)
            remainingBudget -= tokens
          }
        }
      }

      // Also search conversation purpose_summary and rolling_summary from other conversations
      if (remainingBudget > 500) {
        const { data: otherConvs } = await db
          .from('conversations')
          .select('id, title, purpose_summary, rolling_summary')
          .eq('user_id', userId)
          .neq('id', conversationId)
          .not('purpose_summary', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(30)

        if (otherConvs && otherConvs.length > 0) {
          const scoredConvs = otherConvs
            .map(conv => {
              const text = `${conv.title || ''} ${conv.purpose_summary || ''} ${conv.rolling_summary || ''}`.toLowerCase()
              let matchCount = 0
              for (const kw of keywords) {
                if (text.includes(kw)) matchCount++
              }
              return { conv, score: matchCount }
            })
            .filter(s => s.score > 1)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)

          for (const { conv } of scoredConvs) {
            if (remainingBudget < 300) break
            const parts: string[] = []
            if (conv.title) parts.push(`Topic: ${conv.title}`)
            if (conv.purpose_summary) parts.push(conv.purpose_summary)
            if (conv.rolling_summary) parts.push(conv.rolling_summary.substring(0, 400))
            const entry = parts.join(' — ')
            const tokens = estimateTokens(entry)
            if (tokens < remainingBudget) {
              result.crossConversationContext.push(entry)
              remainingBudget -= tokens
            }
          }
        }
      }

      result.debugInfo.crossConversationCount = result.crossConversationContext.length
    }
  } catch (e: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ContextBuilder] Cross-conversation search skipped:', e.message)
    }
  }

  // 7. Load user-level memories (cross-conversation)
  if (includeUserMemories) {
    try {
      const { data: userMems } = await db
        .from('user_memories')
        .select('memory_text, category, importance')
        .eq('user_id', userId)
        .order('importance', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(15)

      if (userMems && userMems.length > 0) {
        const messageWords = latestUserMessage.toLowerCase().split(/\s+/).filter(w => w.length > 3)

        const scored = userMems.map(mem => {
          let score = mem.importance * 10
          const memLower = mem.memory_text.toLowerCase()
          score += messageWords.filter(w => memLower.includes(w)).length * 15
          if (mem.category === 'preference') score += 5
          if (mem.category === 'project') score += 5
          return { mem, score }
        }).sort((a, b) => b.score - a.score)

        for (const { mem } of scored.slice(0, 10)) {
          if (remainingBudget < 100) break
          const tokens = estimateTokens(mem.memory_text)
          if (tokens < remainingBudget) {
            result.userMemories.push(mem.memory_text)
            remainingBudget -= tokens
          }
        }
        result.debugInfo.memoriesCount = result.userMemories.length
      }
    } catch (e: any) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[ContextBuilder] User memories fetch skipped:', e.message)
      }
    }
  }

  result.debugInfo.estimatedTokens = maxTokenBudget - remainingBudget
  result.debugInfo.fileNamesIncluded = Array.from(new Set(result.debugInfo.fileNamesIncluded))

  if (process.env.NODE_ENV !== 'production') {
    console.log('[ContextBuilder] Built context:', result.debugInfo)
  }

  return result
}

export function formatContextForPrompt(context: BuiltContext): string {
  const sections: string[] = []

  if (context.conversationSummary) {
    sections.push(`CONVERSATION CONTEXT:\n${context.conversationSummary}`)
  }

  if (context.conversationMemories.length > 0) {
    sections.push(`KEY FACTS FROM THIS CONVERSATION:\n${context.conversationMemories.map(m => `- ${m}`).join('\n')}`)
  }

  if (context.attachmentSummaries.length > 0) {
    sections.push(`FILES/IMAGES SHARED IN THIS CONVERSATION:\n${context.attachmentSummaries.join('\n\n')}`)
  }

  if (context.relevantChunks.length > 0) {
    sections.push(`RELEVANT EARLIER CONTENT:\n${context.relevantChunks.join('\n---\n')}`)
  }

  if (context.crossConversationContext.length > 0) {
    sections.push(`RELEVANT CONTEXT FROM USER'S PREVIOUS CONVERSATIONS:\nThe following information was found in the user's earlier conversations and is relevant to their current question. Use it to provide continuity.\n${context.crossConversationContext.map(m => `- ${m}`).join('\n')}`)
  }

  if (context.userMemories.length > 0) {
    sections.push(`LONG-TERM MEMORY (about this user):\nThe following are facts previously saved about this user. Use them to personalize your responses when relevant. Do not mention that you have a memory system unless the user asks.\n${context.userMemories.map(m => `- ${m}`).join('\n')}`)
  }

  return sections.join('\n\n')
}

export async function searchCrossConversationContext(
  db: SupabaseClient,
  userId: string,
  latestMessage: string
): Promise<string | null> {
  try {
    const keywords = extractSearchKeywords(latestMessage)
    if (keywords.length === 0) return null

    const sections: string[] = []
    let tokenBudget = 4000

    // Search conversation_memories across all user conversations
    const { data: crossMemories } = await db
      .from('conversation_memories')
      .select('title, content, scope, importance')
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50)

    if (crossMemories && crossMemories.length > 0) {
      const scored = crossMemories
        .map(mem => {
          const text = `${mem.title || ''} ${mem.content}`.toLowerCase()
          let matchCount = 0
          for (const kw of keywords) {
            if (text.includes(kw)) matchCount++
          }
          return { mem, score: matchCount + (mem.importance || 0) * 0.5 }
        })
        .filter(s => s.score > 1)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)

      const memEntries: string[] = []
      for (const { mem } of scored) {
        const entry = mem.title ? `${mem.title}: ${mem.content}` : mem.content
        const tokens = estimateTokens(entry)
        if (tokens > tokenBudget) break
        memEntries.push(`- ${entry}`)
        tokenBudget -= tokens
      }
      if (memEntries.length > 0) {
        sections.push(`RELEVANT CONTEXT FROM PREVIOUS CONVERSATIONS:\n${memEntries.join('\n')}`)
      }
    }

    // Search conversation summaries
    if (tokenBudget > 500) {
      const { data: convs } = await db
        .from('conversations')
        .select('title, purpose_summary, rolling_summary')
        .eq('user_id', userId)
        .not('purpose_summary', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(30)

      if (convs && convs.length > 0) {
        const scoredConvs = convs
          .map(conv => {
            const text = `${conv.title || ''} ${conv.purpose_summary || ''} ${conv.rolling_summary || ''}`.toLowerCase()
            let matchCount = 0
            for (const kw of keywords) {
              if (text.includes(kw)) matchCount++
            }
            return { conv, score: matchCount }
          })
          .filter(s => s.score > 1)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)

        const convEntries: string[] = []
        for (const { conv } of scoredConvs) {
          const parts: string[] = []
          if (conv.title) parts.push(`Topic: ${conv.title}`)
          if (conv.purpose_summary) parts.push(conv.purpose_summary)
          if (conv.rolling_summary) parts.push(conv.rolling_summary.substring(0, 400))
          const entry = parts.join(' — ')
          const tokens = estimateTokens(entry)
          if (tokens > tokenBudget) break
          convEntries.push(`- ${entry}`)
          tokenBudget -= tokens
        }
        if (convEntries.length > 0) {
          sections.push(`RELATED EARLIER CONVERSATIONS:\n${convEntries.join('\n')}`)
        }
      }
    }

    // Search memory chunks
    if (tokenBudget > 500) {
      const { data: chunks } = await db
        .from('memory_chunks')
        .select('content, summary, source_type')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(40)

      if (chunks && chunks.length > 0) {
        const scored = chunks
          .map(chunk => {
            const text = (chunk.summary || chunk.content).toLowerCase()
            let matchCount = 0
            for (const kw of keywords) {
              if (text.includes(kw)) matchCount++
            }
            return { chunk, score: matchCount }
          })
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)

        const chunkEntries: string[] = []
        for (const { chunk } of scored) {
          const text = chunk.summary || chunk.content.substring(0, 600)
          const tokens = estimateTokens(text)
          if (tokens > tokenBudget) break
          chunkEntries.push(text)
          tokenBudget -= tokens
        }
        if (chunkEntries.length > 0) {
          sections.push(`RELEVANT EARLIER CONTENT:\n${chunkEntries.join('\n---\n')}`)
        }
      }
    }

    if (sections.length === 0) return null
    return sections.join('\n\n')
  } catch (e: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ContextBuilder] Cross-conversation search error:', e.message)
    }
    return null
  }
}
