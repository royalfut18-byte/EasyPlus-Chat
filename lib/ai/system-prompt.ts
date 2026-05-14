import type { AIModel } from '@/types/models'

interface SystemPromptOptions {
  model: AIModel
  webSearchEnabled: boolean
  webSearchPerformed: boolean
  webSearchFailed?: boolean
  artifactMode: boolean
  hasSearchResults: boolean
  memoryContext?: string
}

function getCurrentDateString(): string {
  try {
    return new Date().toLocaleString('en-AU', {
      timeZone: 'Australia/Sydney',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return new Date().toISOString().split('T')[0]
  }
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const { model, webSearchPerformed, webSearchFailed, artifactMode, hasSearchResults, memoryContext } = options

  const providerName = model.id === 'claude-haiku-4.5' ? 'OpenAI' : (model.provider === 'google' ? 'Google' : 'Anthropic')
  const currentDate = getCurrentDateString()

  let prompt = `You are ${model.name}.

Respond naturally, accurately, and helpfully. Use the conversation context.

If asked what model you are, answer exactly according to the selected model identity.`

  if (webSearchPerformed && hasSearchResults) {
    prompt += `

WEB SEARCH CONTEXT:
- Search results are provided below. Use them for current/factual claims.
- Cite sources by name and URL when making factual claims from search.
- Do not mix search results with guesses.`
  } else if (webSearchPerformed && !hasSearchResults) {
    prompt += `

WEB SEARCH: Search was attempted but returned no results. State your knowledge may be outdated.`
  } else if (webSearchFailed) {
    prompt += `

WEB SEARCH: Search failed. Answer from training data with caveats.`
  }

  prompt += `

If no search context is provided, do not pretend to have live information.

If document or image context is provided, use it to answer the user's question.`

  prompt += `

CURRENT DATE/TIME: ${currentDate} (Australia/Sydney)

For HSC English responses:
- Write with a clear conceptual thesis.
- Use integrated comparison where relevant.
- Analyse technique, evidence, context, purpose, and audience.
- Link every paragraph directly to the question.
- Use concise Band 6 analytical density.
- Embed quotes naturally.
- Avoid generic filler and over-explaining.
- Prioritise sophistication, clarity, and textual specificity.
- Do not force citations or search formatting into essay responses unless the user explicitly asks for research or current information.

For maths:
- Use clear working and LaTeX where appropriate.
- Use inline math ($...$) for short expressions, display math ($$...$$) for multi-step working.
- Label final answers clearly.

Use clean markdown. Do not output broken formatting.`

  if (memoryContext) {
    prompt += `

${memoryContext}`
  }

  if (artifactMode) {
    prompt += `

ARTIFACT MODE:
When the user asks for buildable code/UI artifacts, return a brief explanation then one artifact block:

\`\`\`artifact:LANGUAGE:Title
CODE_HERE
\`\`\`

Languages: html, tsx, jsx, javascript, css, python, markdown, text.
For web previews, use complete single-file HTML with inline CSS/JS.
Do not output raw HTML outside artifact blocks. Do not include secrets or API keys.`
  }

  return prompt
}

export function isTimeSensitiveQuery(message: string): boolean {
  const lower = message.toLowerCase()

  const timeSensitivePatterns = [
    /\b(latest|current|today|now|recent|live|just happened|this week|this month|this year|yesterday|tonight|right now)\b/,
    /\b(news|score|price|weather|stock|market|election|result|announcement|update)\b/,
    /\b(who won|who is winning|what happened|what's happening|what is happening)\b/,
    /\b(budget 202[4-9]|budget 203[0-9])\b/,
    /\b(new law|new policy|new regulation|new rule|passed|announced|released|launched)\b/,
    /\b(how much is|what is the price|current rate|exchange rate)\b/,
    /\b(chalmers|treasurer|federal budget|aus budget|australian budget)\b/,
    /\b(didn'?t it|already happen|has it happened|did it happen)\b/,
  ]

  return timeSensitivePatterns.some(pattern => pattern.test(lower))
}

export function detectQueryType(message: string): 'factual' | 'creative' | 'conversational' {
  const lower = message.toLowerCase()

  const creativePatterns = [
    /\b(write|create|compose|draft|generate|make up|imagine|story|poem|song|fiction)\b/,
    /\b(creative|funny|joke|humor|roleplay)\b/,
  ]

  if (creativePatterns.some(p => p.test(lower))) {
    return 'creative'
  }

  const factualPatterns = [
    /\b(what is|who is|when did|where is|how much|how many|explain|define|compare)\b/,
    /\b(latest|current|news|facts|data|statistics|budget|policy|law|price|rate)\b/,
    /\b(calculate|solve|convert|formula)\b/,
    /\?$/,
  ]

  if (factualPatterns.some(p => p.test(lower))) {
    return 'factual'
  }

  return 'conversational'
}
