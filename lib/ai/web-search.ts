import { tavily } from '@tavily/core'
import type { ChatMessage } from '@/types/models'

const AMBIGUOUS_PATTERNS = [
  /\b(it|that|this|these|those)\b/i,
  /\b(he|she|they|their|his|her|him)\b/i,
  /\b(what about|and now|so is|tell me more)\b/i,
  /\blatest news on (that|it|this)\b/i,
  /\b(going up|going down)\b/i,
  /\bwhat happened (next|after)\b/i,
]

const IRRELEVANT_TOPICS = [
  /\b(ai model|what model|which model|gemini|claude|opus|what ai)\b/i,
  /\b(you are|identity|powered by)\b/i,
  /\bui\b.*\bmodel\b/i,
  /\bmodel\b.*\bselection\b/i,
]

const REPUTABLE_DOMAINS = [
  'gov.au', 'gov.uk', 'gov', '.edu',
  'abc.net.au', 'sbs.com.au', 'afr.com', 'smh.com.au', 'theaustralian.com.au',
  'theguardian.com', 'bbc.com', 'bbc.co.uk', 'reuters.com', 'apnews.com',
  'nytimes.com', 'washingtonpost.com', 'ft.com', 'economist.com',
  '9news.com.au', '7news.com.au', 'news.com.au',
  'budget.gov.au', 'treasury.gov.au', 'ato.gov.au', 'homeaffairs.gov.au',
  'asx.com.au', 'rba.gov.au',
]

const LOW_QUALITY_DOMAINS = [
  'quora.com', 'reddit.com', 'yahoo.com/answers',
  'wikihow.com', 'ehow.com', 'turbotax',
  'pinterest.com', 'facebook.com', 'tiktok.com',
]

export function needsWebSearch(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const keywords = [
    'latest', 'current', 'today', 'now', 'recent', 'live',
    'news', 'score', 'price', 'weather', 'who won', 'search',
    'lookup', 'look up', 'yesterday', 'this week', 'this month',
    'update', 'happening', 'just happened', 'announced', 'released',
    'new policy', 'new law', 'budget 202', 'election',
  ]
  return keywords.some((keyword) => lowerMessage.includes(keyword))
}

function isAmbiguousFollowUp(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim()

  if (lowerMessage.length < 15) {
    return true
  }

  const hasAmbiguousPattern = AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(message))

  if (hasAmbiguousPattern) {
    const hasNamedEntities = /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(message) ||
                             /\b[A-Z]{2,}\b/.test(message) ||
                             /\d{4}/.test(message)

    if (hasNamedEntities) {
      return false
    }

    return true
  }

  return false
}

function isRelevantMessage(message: ChatMessage): boolean {
  const content = message.content.toLowerCase()
  return !IRRELEVANT_TOPICS.some((pattern) => pattern.test(content))
}

function detectLocation(message: string): string | null {
  const lower = message.toLowerCase()

  const locationPatterns: [RegExp, string][] = [
    [/\b(australia|australian|aussie|aus)\b/i, 'Australia'],
    [/\b(budget\.gov\.au|treasury\.gov\.au|ato\.gov\.au)\b/i, 'Australia'],
    [/\b(afl|nrl|cricket australia|ashes)\b/i, 'Australia'],
    [/\b(uk|united kingdom|british|britain|england)\b/i, 'UK'],
    [/\b(us|usa|united states|american)\b/i, 'US'],
    [/\b(india|indian)\b/i, 'India'],
    [/\b(jim chalmers|albanese|dutton|treasurer)\b/i, 'Australia'],
  ]

  for (const [pattern, location] of locationPatterns) {
    if (pattern.test(lower)) {
      return location
    }
  }

  return null
}

function getCurrentDateInfo() {
  const now = new Date()
  const sydneyDate = new Date(now.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }))
  return {
    year: sydneyDate.getFullYear(),
    month: sydneyDate.toLocaleString('en-US', { month: 'long' }),
    day: sydneyDate.getDate(),
    dateStr: sydneyDate.toLocaleDateString('en-AU'),
  }
}

function buildSearchTerms(message: string, location: string | null): string[] {
  const lower = message.toLowerCase()
  const { year, month, day } = getCurrentDateInfo()
  const queries: string[] = []

  if (/budget/i.test(lower) && location === 'Australia') {
    // Australian budget is typically delivered in May
    // If we're past the budget date, search for delivered/outcomes
    const budgetDelivered = year > 2026 || (year === 2026 && (new Date().getMonth() > 4 || (new Date().getMonth() === 4 && day >= 12)))

    if (budgetDelivered || /already|happened|delivered|passed|announced/i.test(lower)) {
      queries.push(`Australian federal budget ${year}-${(year + 1).toString().slice(-2)} delivered speech key measures`)
      queries.push(`Treasurer Jim Chalmers budget ${year} winners losers summary`)
    } else {
      queries.push(`${year} Australian federal budget announcements ${month} ${year}`)
      queries.push(`Australia budget ${year}-${(year + 1).toString().slice(-2)} Treasurer Jim Chalmers`)
    }
  } else if (/budget/i.test(lower)) {
    queries.push(`${location || ''} budget ${year} latest announcements`.trim())
  }

  if (queries.length === 0) {
    let base = message.trim()
    if (base.length > 150) {
      base = base.substring(0, 150).trim()
    }

    const hasTimeWord = /\b(today|yesterday|now|this week|this month|latest|current|recent)\b/i.test(base)
    if (!hasTimeWord) {
      base = `${base} ${month} ${year}`
    }

    if (location) {
      base = `${base} ${location}`
    }

    queries.push(base)
  }

  return queries
}

export function buildWebSearchQuery(
  latestUserMessage: string,
  recentMessages: ChatMessage[]
): string {
  const isAmbiguous = isAmbiguousFollowUp(latestUserMessage)
  let messageForQuery = latestUserMessage

  if (isAmbiguous) {
    const contextMessages = recentMessages
      .slice(-5, -1)
      .filter(isRelevantMessage)
      .slice(-4)

    if (contextMessages.length > 0) {
      const context = contextMessages
        .map((m) => m.content)
        .join(' ')
        .substring(0, 200)

      messageForQuery = `${context} ${latestUserMessage}`
    }
  }

  const location = detectLocation(messageForQuery)
  const queries = buildSearchTerms(messageForQuery, location)

  const query = queries[0] || messageForQuery

  if (query.length > 250) {
    return query.substring(0, 250).trim()
  }

  console.log('[WebSearch] Built query:', query, '| location:', location)
  return query
}

interface SearchResult {
  title: string
  url: string
  content: string
  score: number
  isReputable: boolean
}

const POST_EVENT_SIGNALS = [
  'delivered', 'handed down', 'announced', 'speech', 'budget papers',
  'winners and losers', 'as it happened', 'key measures', 'summary',
  'confirmed', 'passed', 'released', 'unveiled',
]

const PREVIEW_SIGNALS = [
  'when is the budget', 'what to expect', 'scheduled for',
  'preview', 'what we know so far', 'ahead of', 'upcoming',
  'tonight', 'will be delivered', 'expected to',
]

function scoreResult(result: any, userMessage: string): SearchResult {
  const url = (result.url || '').toLowerCase()
  const title = result.title || ''
  const content = result.content || result.snippet || ''

  let score = 0

  const isReputable = REPUTABLE_DOMAINS.some(d => url.includes(d))
  const isLowQuality = LOW_QUALITY_DOMAINS.some(d => url.includes(d))

  if (isReputable) score += 30
  if (isLowQuality) score -= 40
  if (url.includes('.gov')) score += 20

  const userWords = userMessage.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  const combinedText = `${title} ${content}`.toLowerCase()
  const matchingWords = userWords.filter(w => combinedText.includes(w))
  score += matchingWords.length * 10

  if (content.length > 200) score += 10
  if (content.length > 500) score += 10

  // Prefer post-event articles over preview/upcoming articles
  const hasPostEventSignal = POST_EVENT_SIGNALS.some(s => combinedText.includes(s))
  const hasPreviewSignal = PREVIEW_SIGNALS.some(s => combinedText.includes(s))

  if (hasPostEventSignal) score += 25
  if (hasPreviewSignal && hasPostEventSignal) score += 0 // mixed, no penalty
  else if (hasPreviewSignal) score -= 20

  // Prefer official budget domains
  if (url.includes('budget.gov.au')) score += 30
  if (url.includes('treasury.gov.au')) score += 25
  if (url.includes('pmc.gov.au')) score += 20

  return { title, url: result.url, content, score, isReputable }
}

function filterAndRankResults(results: any[], userMessage: string): SearchResult[] {
  const scored = results.map(r => scoreResult(r, userMessage))

  const filtered = scored.filter(r => r.score > -10)

  filtered.sort((a, b) => b.score - a.score)

  return filtered.slice(0, 6)
}

export interface WebSearchResult {
  context: string | null
  failed: boolean
  resultCount: number
}

export async function searchWeb(query: string, userMessage?: string): Promise<WebSearchResult> {
  const apiKey = process.env.TAVILY_API_KEY

  if (!apiKey) {
    console.warn('[Web Search] TAVILY_API_KEY not set, skipping web search')
    return { context: null, failed: true, resultCount: 0 }
  }

  try {
    console.log('[Web Search] Searching for:', query)

    const tvly = tavily({ apiKey })

    const response = await tvly.search(query, {
      maxResults: 10,
      includeAnswer: false,
      searchDepth: 'advanced',
      days: 7,
    })

    if (!response.results || response.results.length === 0) {
      console.log('[Web Search] No results found')
      return { context: null, failed: false, resultCount: 0 }
    }

    const ranked = filterAndRankResults(response.results, userMessage || query)

    if (ranked.length === 0) {
      console.log('[Web Search] All results filtered as irrelevant')
      return { context: null, failed: false, resultCount: 0 }
    }

    console.log('[Web Search] Ranked results:', ranked.length, 'from', response.results.length, 'raw')

    const context = ranked
      .map((result, index) => {
        const reputeTag = result.isReputable ? ' [REPUTABLE SOURCE]' : ''
        return `[Source ${index + 1}] ${result.title}${reputeTag}
URL: ${result.url}
${result.content}`
      })
      .join('\n\n')

    return { context, failed: false, resultCount: ranked.length }
  } catch (error: any) {
    console.error('[Web Search] Error:', error.message)
    return { context: null, failed: true, resultCount: 0 }
  }
}
