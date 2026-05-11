import { tavily } from '@tavily/core'
import type { ChatMessage } from '@/types/models'

const WEB_SEARCH_KEYWORDS = [
  'latest',
  'current',
  'today',
  'now',
  'recent',
  'live',
  'news',
  'score',
  'price',
  'weather',
  'who won',
  'search',
  'lookup',
  'look up',
  'web',
  'yesterday',
  'this week',
  'this month',
  'update',
  'happening',
]

// Words/patterns that indicate ambiguous follow-up questions
const AMBIGUOUS_PATTERNS = [
  /\b(it|that|this|these|those)\b/i,
  /\b(he|she|they|their|his|her|him)\b/i,
  /\b(what about|and now|so is|tell me more)\b/i,
  /\blatest news on (that|it|this)\b/i,
  /\b(going up|going down)\b/i,
  /\bwhat happened (next|after)\b/i,
]

// Topics to filter out from web search context
const IRRELEVANT_TOPICS = [
  /\b(ai model|what model|which model|gemini|claude|opus|what ai)\b/i,
  /\b(you are|identity|powered by)\b/i,
  /\bui\b.*\bmodel\b/i,
  /\bmodel\b.*\bselection\b/i,
]

export function needsWebSearch(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  return WEB_SEARCH_KEYWORDS.some((keyword) => lowerMessage.includes(keyword))
}

/**
 * Check if a message is an ambiguous follow-up that needs context
 */
export function isAmbiguousFollowUp(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim()

  // Very short messages are usually follow-ups
  if (lowerMessage.length < 15) {
    return true
  }

  // Check for ambiguous pronouns/patterns
  const hasAmbiguousPattern = AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(message))

  if (hasAmbiguousPattern) {
    // But if it has specific entities (capitals, named things), it might be specific
    const hasNamedEntities = /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(message) || // "Jim Chalmers"
                             /\b[A-Z]{2,}\b/.test(message) || // "US", "UK", "IPL"
                             /\d{4}/.test(message) // years like "2026"

    // If ambiguous but has entities, still consider it specific
    if (hasNamedEntities) {
      return false
    }

    return true
  }

  return false
}

/**
 * Sanitize and optimize search query
 */
export function sanitizeSearchQuery(query: string): string {
  let sanitized = query.trim()

  // Replace "x" between words with space (iran x us -> iran us)
  sanitized = sanitized.replace(/\s+x\s+/gi, ' ')

  // Add "today" for latest/current/news queries if not present
  const needsToday = /\b(latest|current|update|news)\b/i.test(sanitized)
  const hasTimeword = /\b(today|yesterday|now|this week|this month)\b/i.test(sanitized)

  if (needsToday && !hasTimeword) {
    sanitized = `${sanitized} today`
  }

  // Limit length
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200).trim()
  }

  return sanitized
}

/**
 * Filter out irrelevant messages (like AI model discussions)
 */
function isRelevantMessage(message: ChatMessage): boolean {
  const content = message.content.toLowerCase()
  return !IRRELEVANT_TOPICS.some((pattern) => pattern.test(content))
}

/**
 * Build web search query with smart context handling
 */
export function buildWebSearchQuery(
  latestUserMessage: string,
  recentMessages: ChatMessage[]
): string {
  const isAmbiguous = isAmbiguousFollowUp(latestUserMessage)

  console.log('[WebSearch] latest:', latestUserMessage)
  console.log('[WebSearch] isAmbiguous:', isAmbiguous)

  // If the message is specific, use it directly
  if (!isAmbiguous) {
    const query = sanitizeSearchQuery(latestUserMessage)
    console.log('[WebSearch] query (specific):', query)
    return query
  }

  // For ambiguous follow-ups, add relevant context
  // Get last 4 messages (2 exchanges) excluding the current message
  const contextMessages = recentMessages
    .slice(-5, -1) // Last 4 messages before current
    .filter(isRelevantMessage)
    .slice(-4) // Keep max 4

  if (contextMessages.length === 0) {
    // No context available, just use the message
    const query = sanitizeSearchQuery(latestUserMessage)
    console.log('[WebSearch] query (no context):', query)
    return query
  }

  // Build contextual query
  const context = contextMessages
    .map((m) => m.content)
    .join(' ')
    .substring(0, 300) // Limit context length

  const combinedQuery = `${context} ${latestUserMessage}`
  const query = sanitizeSearchQuery(combinedQuery)

  console.log('[WebSearch] query (with context):', query)
  return query
}

export async function searchWeb(query: string): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY

  if (!apiKey) {
    console.warn('[Web Search] TAVILY_API_KEY not set, skipping web search')
    return null
  }

  try {
    console.log('[Web Search] Searching for:', query)

    const tvly = tavily({ apiKey })

    const response = await tvly.search(query, {
      maxResults: 5,
      includeAnswer: false,
      searchDepth: 'basic',
    })

    if (!response.results || response.results.length === 0) {
      console.log('[Web Search] No results found')
      return null
    }

    console.log('[Web Search] Found', response.results.length, 'results')

    const context = response.results
      .map((result: any, index: number) => {
        return `[${index + 1}] ${result.title}
URL: ${result.url}
${result.content || result.snippet || ''}`
      })
      .join('\n\n')

    return context
  } catch (error: any) {
    console.error('[Web Search] Error:', {
      message: error.message,
      stack: error.stack,
    })
    return null
  }
}
