import type { Message, Artifact } from '@/types/models'
import { parseArtifactFromResponse } from '../artifact-parser'

/**
 * Sort messages chronologically: oldest first, newest last
 */
export function sortMessagesChronologically(messages: Message[]): Message[] {
  if (!Array.isArray(messages)) return []

  return [...messages].sort((a, b) => {
    // Primary sort: created_at ascending (oldest first)
    const timeA = new Date(a?.created_at || 0).getTime()
    const timeB = new Date(b?.created_at || 0).getTime()

    if (timeA !== timeB) {
      return timeA - timeB
    }

    // Secondary sort: user before assistant when times are equal
    if (a?.role !== b?.role) {
      return a?.role === 'user' ? -1 : 1
    }

    // Tertiary sort: by id for stability
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

    // Check for likely duplicates: same conversation, role, content within 3 seconds
    const isDuplicate = result.some(existing => {
      if (
        existing?.conversation_id === msg?.conversation_id &&
        existing?.role === msg?.role &&
        existing?.content === msg?.content
      ) {
        const timeDiff = Math.abs(
          new Date(existing?.created_at || 0).getTime() - new Date(msg?.created_at || 0).getTime()
        )
        return timeDiff < 3000 // Within 3 seconds
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
 * Process messages: dedupe then sort
 * Use this everywhere to ensure consistency
 */
export function processMessages(messages: Message[]): Message[] {
  if (!Array.isArray(messages)) return []
  return sortMessagesChronologically(dedupeMessages(messages))
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
