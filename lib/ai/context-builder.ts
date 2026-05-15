import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from '@/types/models'

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
  debugInfo: {
    recentMessagesCount: number
    memoriesCount: number
    chunksCount: number
    attachmentSummariesCount: number
    estimatedTokens: number
    provider: string
  }
}

const APPROX_CHARS_PER_TOKEN = 4
const DEFAULT_TOKEN_BUDGET = 24000

function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN)
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
    debugInfo: {
      recentMessagesCount: 0,
      memoriesCount: 0,
      chunksCount: 0,
      attachmentSummariesCount: 0,
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

  // 3. Load attachment summaries for this conversation
  try {
    const { data: attachments } = await db
      .from('attachments')
      .select('file_name, file_type, extracted_text, vision_summary, ocr_text, important_details, purpose_note, created_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (remainingBudget < 500) break

        let summary = ''
        if (att.purpose_note) summary += att.purpose_note + '\n'
        if (att.vision_summary) summary += `Visual: ${att.vision_summary}\n`
        if (att.ocr_text) summary += `Text found: ${att.ocr_text.substring(0, 500)}\n`
        if (att.extracted_text && !att.ocr_text) {
          summary += `Content: ${att.extracted_text.substring(0, 800)}\n`
        }
        if (att.important_details && Object.keys(att.important_details).length > 0) {
          summary += `Details: ${JSON.stringify(att.important_details)}\n`
        }

        if (summary) {
          const label = `[Attached ${att.file_type || 'file'}: ${att.file_name}]\n${summary.trim()}`
          const tokens = estimateTokens(label)
          if (tokens < remainingBudget) {
            result.attachmentSummaries.push(label)
            remainingBudget -= tokens
          }
        }
      }
      result.debugInfo.attachmentSummariesCount = result.attachmentSummaries.length
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
  try {
    const keywords = latestUserMessage
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 5)

    if (keywords.length > 0) {
      const { data: chunks } = await db
        .from('memory_chunks')
        .select('content, summary, source_type')
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (chunks && chunks.length > 0) {
        const scored = chunks
          .map(chunk => {
            const text = (chunk.summary || chunk.content).toLowerCase()
            const matchCount = keywords.filter(kw => text.includes(kw)).length
            return { chunk, score: matchCount }
          })
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)

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

  // 6. Load user-level memories (cross-conversation)
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

  if (context.userMemories.length > 0) {
    sections.push(`LONG-TERM MEMORY (about this user):\nThe following are facts previously saved about this user. Use them to personalize your responses when relevant. Do not mention that you have a memory system unless the user asks.\n${context.userMemories.map(m => `- ${m}`).join('\n')}`)
  }

  return sections.join('\n\n')
}
