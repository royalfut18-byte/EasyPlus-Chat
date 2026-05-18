import type { Message, Artifact } from '@/types/models'
import { parseArtifactFromResponse } from '../artifact-parser'

function stripThinkingTags(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').replace(/<thinking>[\s\S]*$/g, '')
}

export const LOADING_MARKERS = new Set([
  '__ARTIFACT_LOADING__',
  '__ASSISTANT_LOADING__',
  '__LONG_TASK_LOADING__',
  '__RECOVERY_POLLING__',
])

const STALE_GENERATING_THRESHOLD_MS = 60_000

export function isMarkerContent(content: string | null | undefined): boolean {
  if (!content) return true
  if (LOADING_MARKERS.has(content)) return true
  if (content.trim() === '...') return true
  return false
}

export function isRealContent(content: string | null | undefined): boolean {
  if (!content) return false
  if (content.trim().length <= 20) return false
  if (LOADING_MARKERS.has(content)) return false
  if (content.trim() === '...') return false
  return true
}

function isStaleGenerating(msg: Message): boolean {
  if (msg.status !== 'generating') return false
  if (!msg.created_at) return true
  const timestamp = msg.updated_at || msg.created_at
  const age = Date.now() - new Date(timestamp).getTime()
  return age > STALE_GENERATING_THRESHOLD_MS
}

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
 * Score a message for priority (higher = keep this one).
 * Used to pick the best message when multiple share the same request_id.
 */
function messageScore(msg: Message): number {
  if (!msg?.content) return 0
  if (LOADING_MARKERS.has(msg.content) || msg.content.trim() === '...') return 1
  if (msg.status === 'generating' && !isRealContent(msg.content)) return 2
  if (msg.status === 'generating' && isRealContent(msg.content)) return 3
  if (msg.status === 'error') return 4
  if (msg.status === 'completed' && isRealContent(msg.content)) return 5 + Math.min(msg.content.length, 10000)
  // Non-marker content with unknown status
  return isRealContent(msg.content) ? 5 + Math.min(msg.content.length, 10000) : 3
}

/**
 * Deduplicate messages by id, client_message_id, request_id, and content similarity.
 * For assistant messages sharing the same request_id, keep only the best one.
 */
export function dedupeMessages(messages: Message[]): Message[] {
  if (!Array.isArray(messages)) return []

  const seenIds = new Set<string>()
  const seenClientIds = new Set<string>()
  // Group assistant messages by request_id to collapse duplicates
  const bestByRequestId = new Map<string, Message>()
  const result: Message[] = []

  // First pass: find the best assistant message per request_id
  for (const msg of messages) {
    if (!msg || !msg.id) continue
    if (msg.role === 'assistant' && msg.request_id) {
      const existing = bestByRequestId.get(msg.request_id)
      if (!existing || messageScore(msg) > messageScore(existing)) {
        bestByRequestId.set(msg.request_id, msg)
      }
    }
  }

  for (const msg of messages) {
    if (!msg || !msg.id) continue

    // Skip if we've seen this exact ID
    if (seenIds.has(msg.id)) continue

    // Skip if we've already seen this client_message_id
    if (msg.client_message_id && seenClientIds.has(msg.client_message_id)) continue

    // For assistant messages with request_id: only keep the best one
    if (msg.role === 'assistant' && msg.request_id) {
      const best = bestByRequestId.get(msg.request_id)
      if (best && best.id !== msg.id) continue // Skip non-best
    }

    // Remove loading markers if a real completed message exists for the SAME request_id
    // But never remove active generating placeholders — those are live thinking bubbles
    if (msg.role === 'assistant' && LOADING_MARKERS.has(msg.content || '') && msg.status !== 'generating') {
      if (msg.request_id) {
        const hasRealForSameRequest = result.some(existing =>
          existing.role === 'assistant' &&
          existing.request_id === msg.request_id &&
          !LOADING_MARKERS.has(existing.content || '') &&
          existing.content && existing.content.length > 10
        )
        if (hasRealForSameRequest) continue
      }
    }

    // Check for likely duplicates: same conversation, role, content within 5 minutes
    const isDuplicate = result.some(existing => {
      if (
        existing?.conversation_id === msg?.conversation_id &&
        existing?.role === msg?.role &&
        existing?.content === msg?.content &&
        existing?.content?.length > 0 &&
        !LOADING_MARKERS.has(existing.content || '')
      ) {
        const timeDiff = Math.abs(
          new Date(existing?.created_at || 0).getTime() - new Date(msg?.created_at || 0).getTime()
        )
        return timeDiff < 300000
      }
      return false
    })

    if (isDuplicate) continue

    seenIds.add(msg.id)
    if (msg.client_message_id) seenClientIds.add(msg.client_message_id)
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
 * Remove stale loading markers and stale generating messages.
 * REQUEST-SCOPED: only removes a marker if a real response exists for the SAME request_id.
 * Never removes markers just because another assistant message elsewhere has content.
 */
function removeStaleMarkers(messages: Message[]): Message[] {
  if (messages.length < 2) return messages

  const requestIdsWithContent = new Set<string>()

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.request_id && isRealContent(msg.content)) {
      requestIdsWithContent.add(msg.request_id)
    }
  }

  const removed: Array<{ id: string; reason: string }> = []

  const result = messages.filter(msg => {
    if (msg.role !== 'assistant') return true

    const content = msg.content || ''

    // NEVER remove assistant messages with real content
    if (isRealContent(content)) return true

    // Filter out marker-only messages (includes "...")
    if (isMarkerContent(content)) {
      // Same request already has real content — this is a leftover placeholder
      if (msg.request_id && requestIdsWithContent.has(msg.request_id)) {
        removed.push({ id: msg.id, reason: 'request_id has real content' })
        return false
      }
      // Stale generating (>60s) with no real content
      if (isStaleGenerating(msg)) {
        removed.push({ id: msg.id, reason: 'stale generating marker' })
        return false
      }
      // Active generating placeholder — keep it
      if (msg.status === 'generating') return true
      // Non-generating marker with no request_id and old (>60s) — likely orphan
      if (!msg.request_id && !msg.status) {
        const age = Date.now() - new Date(msg.updated_at || msg.created_at || 0).getTime()
        if (age > STALE_GENERATING_THRESHOLD_MS) {
          removed.push({ id: msg.id, reason: 'orphan marker >60s' })
          return false
        }
      }
      return true
    }

    // Short/empty assistant messages that are stale generating — remove
    if (!isRealContent(content) && isStaleGenerating(msg)) {
      removed.push({ id: msg.id, reason: 'stale generating short content' })
      return false
    }

    return true
  })

  if (process.env.NODE_ENV !== 'production' && removed.length > 0) {
    console.log('[Chat] removeStaleMarkers removed:', removed)
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

  // Dedupe, sort, remove stale markers, then repair order
  const deduped = dedupeMessages(filtered)
  const sorted = sortMessagesChronologically(deduped)
  const cleaned = removeStaleMarkers(sorted)
  return repairMessageOrder(cleaned)
}

/**
 * Process loaded messages: dedupe, sort, remove stale markers, parse artifacts
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

  // Remove stale markers and generating ghosts
  const cleaned = removeStaleMarkers(sorted)

  // Strip <thinking> tags from assistant messages saved in DB
  for (const msg of cleaned) {
    if (msg.role === 'assistant' && msg.content && msg.content.includes('<thinking>')) {
      msg.content = stripThinkingTags(msg.content)
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    const conversationId = options?.conversationId || 'unknown'
    const realAssistantMessages = cleaned.filter(m => m.role === 'assistant' && isRealContent(m.content))
    const generatingMessages = cleaned.filter(m => m.role === 'assistant' && m.status === 'generating')
    const removedMessages = sorted.filter(m => !cleaned.includes(m))

    console.log('[Chat] processLoadedMessages:', {
      conversationId,
      totalRaw: messages.length,
      totalCleaned: cleaned.length,
      realAssistantKept: realAssistantMessages.length,
      generatingKept: generatingMessages.length,
    })

    for (const removed of removedMessages) {
      const isReal = isRealContent(removed.content)
      const logFn = isReal ? console.error : console.log
      logFn('[Chat] Message removed:', {
        id: removed.id,
        role: removed.role,
        request_id: removed.request_id || null,
        parent_message_id: (removed as any).parent_message_id || null,
        contentPreview: (removed.content || '').slice(0, 40),
        isRealContent: isReal,
        status: removed.status,
        reason: isReal ? 'ERROR: Real assistant message removed!' : 'marker/stale',
      })
    }
  }

  // Parse artifacts from old messages if requested (only in browser)
  if (typeof window !== 'undefined' && options?.parseArtifacts && options?.conversationId) {
    return parseArtifactsFromMessages(cleaned, options.conversationId)
  }

  return cleaned
}

/**
 * Parse artifacts from old assistant messages.
 * SAFETY: NEVER replace or truncate message.content.
 * Only attach the artifact metadata for the artifact panel.
 * The original full content is always preserved for display.
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
      const { artifact } = parseArtifactFromResponse(
        message.content,
        true,
        ''
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

        // PRESERVE original content — only attach artifact metadata
        processed.push({
          ...message,
          artifact,
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
