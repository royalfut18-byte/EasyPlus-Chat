import type { Message, Artifact } from '@/types/models'
import { parseArtifactFromResponse } from '../artifact-parser'

/**
 * Sort messages chronologically: oldest first, newest last
 * Respects order_index as primary sort key
 */
export function sortMessagesChronologically(messages: Message[]): Message[] {
  if (!Array.isArray(messages)) return []

  return [...messages].sort((a, b) => {
    // Primary sort: order_index ascending (nulls last)
    const orderA = typeof a?.order_index === 'number' ? a.order_index : Number.MAX_SAFE_INTEGER
    const orderB = typeof b?.order_index === 'number' ? b.order_index : Number.MAX_SAFE_INTEGER

    if (orderA !== orderB) {
      return orderA - orderB
    }

    // Secondary sort: created_at ascending (oldest first)
    const timeA = new Date(a?.created_at || 0).getTime()
    const timeB = new Date(b?.created_at || 0).getTime()

    if (timeA !== timeB) {
      return timeA - timeB
    }

    // Tertiary sort: user before assistant when times are equal
    if (a?.role !== b?.role) {
      return a?.role === 'user' ? -1 : 1
    }

    // Quaternary sort: by id for stability
    return String(a?.id || '').localeCompare(String(b?.id || ''))
  })
}

/**
 * Deduplicate messages by id and likely duplicates
 */
export function dedupeMessages(messages: Message[]): Message[] {
  if (!Array.isArray(messages)) return []

  const seenIds = new Set<string>()
  const result: Message[] = []

  for (const msg of messages) {
    if (!msg || !msg.id) continue

    // Skip if we've seen this exact ID
    if (seenIds.has(msg.id)) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Chat] Removing duplicate message by ID:', msg.id)
      }
      continue
    }

    // Check for likely duplicates: same conversation, role, content within 60 seconds
    // Wider window needed because server-saved messages may have different timestamps
    // than client-side optimistic messages (especially for long API calls)
    const isDuplicate = result.some(existing => {
      if (
        existing?.conversation_id === msg?.conversation_id &&
        existing?.role === msg?.role &&
        existing?.content === msg?.content
      ) {
        const timeDiff = Math.abs(
          new Date(existing?.created_at || 0).getTime() - new Date(msg?.created_at || 0).getTime()
        )
        return timeDiff < 60000 // Within 60 seconds
      }
      return false
    })

    if (isDuplicate) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Chat] Removing likely duplicate message:', msg.id)
      }
      continue
    }

    seenIds.add(msg.id)
    result.push(msg)
  }

  return result
}

/**
 * Filter messages by conversation ID
 */
function filterMessagesForConversation(messages: Message[], conversationId: string | null): Message[] {
  if (!conversationId) return []
  if (!Array.isArray(messages)) return []

  return messages.filter(m => {
    if (!m) return false
    // Must match conversation ID exactly
    return m.conversation_id === conversationId
  })
}

/**
 * Repair message order for old chats with bad timestamps
 * If assistant appears before user with close timestamps, swap them
 */
function repairMessageOrder(messages: Message[]): Message[] {
  if (!Array.isArray(messages) || messages.length < 2) return messages

  const result = [...messages]
  let i = 0

  while (i < result.length - 1) {
    const current = result[i]
    const next = result[i + 1]

    // If current is assistant and next is user with close timestamps
    if (
      current?.role === 'assistant' &&
      next?.role === 'user' &&
      current.created_at &&
      next.created_at
    ) {
      const timeDiff = Math.abs(
        new Date(current.created_at).getTime() - new Date(next.created_at).getTime()
      )

      // If timestamps are within 10 seconds, swap them
      if (timeDiff <= 10000) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[Chat] Repairing message order: swapping assistant/user pair', {
            assistantId: current.id,
            userId: next.id,
            timeDiff,
          })
        }
        // Swap
        result[i] = next
        result[i + 1] = current
        i += 2 // Skip both to avoid re-swapping
        continue
      }
    }

    i++
  }

  return result
}

/**
 * Process messages: filter by conversation, dedupe, then sort
 * Use this everywhere to ensure consistency
 */
export function processMessages(messages: Message[], conversationId?: string | null): Message[] {
  if (!Array.isArray(messages)) return []

  // If conversation ID provided, filter first to prevent message mixing
  const filtered = conversationId
    ? filterMessagesForConversation(messages, conversationId)
    : messages

  // Warn in dev if we filtered out messages from wrong conversation
  if (process.env.NODE_ENV !== 'production' && conversationId && filtered.length !== messages.length) {
    const wrongCount = messages.length - filtered.length
    console.warn('[Chat] Filtered out messages from wrong conversation', {
      conversationId,
      wrongCount,
      totalMessages: messages.length,
      filteredMessages: filtered.length
    })
  }

  // Dedupe, sort, then repair any remaining order issues
  const sorted = sortMessagesChronologically(dedupeMessages(filtered))
  return repairMessageOrder(sorted)
}

/**
 * Process loaded messages: dedupe, sort, parse artifacts
 */
export function processLoadedMessages(
  messages: Message[],
  options?: {
    conversationId?: string
    parseArtifacts?: boolean
  }
): Message[] {
  if (!Array.isArray(messages)) return []

  // Dedupe first
  const deduped = dedupeMessages(messages)

  // Sort chronologically
  const sorted = sortMessagesChronologically(deduped)

  // Parse artifacts from old messages if requested (only in browser)
  if (typeof window !== 'undefined' && options?.parseArtifacts && options?.conversationId) {
    return parseArtifactsFromMessages(sorted, options.conversationId)
  }

  return sorted
}

/**
 * Parse artifacts from old assistant messages
 */
function parseArtifactsFromMessages(
  messages: Message[],
  conversationId: string
): Message[] {
  if (!Array.isArray(messages) || typeof window === 'undefined') return messages

  const processed: Message[] = []

  for (const message of messages) {
    if (!message) continue

    if (message.role === 'assistant' && message.content && !message.artifact) {
      // Try to parse artifact from old message
      const { artifact, cleanContent } = parseArtifactFromResponse(
        message.content,
        true, // Always try to parse for old messages
        '' // No user prompt context
      )

      if (artifact && artifact.title && artifact.language && artifact.code) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[Chat] Found artifact in old message:', artifact.title)
        }

        // Save to localStorage (browser only)
        try {
          const artifactData = JSON.stringify(artifact)
          localStorage.setItem(`easyplus:artifact:${conversationId}:${message.id}`, artifactData)
          localStorage.setItem(`easyplus:artifact:${conversationId}:latest`, artifactData)
        } catch (e) {
          console.error('[Chat] Failed to save artifact:', e)
        }

        // Ensure clean content
        let finalContent = cleanContent?.trim() || ''
        if (!finalContent) {
          finalContent = `I created an artifact for you: **${artifact.title}**.`
        }

        processed.push({
          ...message,
          artifact,
          content: finalContent,
        })
      } else {
        processed.push(message)
      }
    } else {
      processed.push(message)
    }
  }

  return processed
}

/**
 * Get stored artifact for a conversation
 */
export function getStoredArtifact(conversationId: string, messageId?: string): Artifact | null {
  if (typeof window === 'undefined') return null

  try {
    const key = messageId
      ? `easyplus:artifact:${conversationId}:${messageId}`
      : `easyplus:artifact:${conversationId}:latest`
    const data = localStorage.getItem(key)
    if (!data) return null

    const parsed = JSON.parse(data)
    // Validate artifact has required fields
    if (parsed && parsed.title && parsed.language && parsed.code) {
      return parsed as Artifact
    }

    // Invalid artifact, remove it
    localStorage.removeItem(key)
    return null
  } catch (e) {
    console.error('[Chat] Failed to load stored artifact:', e)
    // Try to remove corrupted data
    try {
      const key = messageId
        ? `easyplus:artifact:${conversationId}:${messageId}`
        : `easyplus:artifact:${conversationId}:latest`
      localStorage.removeItem(key)
    } catch (e2) {
      // Ignore
    }
    return null
  }
}
