import { tavily } from '@tavily/core'

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

export function needsWebSearch(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  return WEB_SEARCH_KEYWORDS.some((keyword) => lowerMessage.includes(keyword))
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
