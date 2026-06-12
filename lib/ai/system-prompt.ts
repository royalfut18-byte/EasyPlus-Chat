import type { AIModel } from '@/types/models'

interface SystemPromptOptions {
  model: AIModel
  webSearchEnabled: boolean
  webSearchPerformed: boolean
  webSearchFailed?: boolean
  artifactMode: boolean
  hasSearchResults: boolean
  hasImageAttachments?: boolean
  memoryContext?: string
  latestUserMessage?: string
}

type TaskProfile = 'rewrite' | 'study' | 'coding' | 'artifact' | 'general'

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

function detectTaskProfile(message: string, artifactMode: boolean): TaskProfile {
  const lower = message.toLowerCase()

  if (artifactMode) return 'artifact'

  const rewriteSignals = [
    'rewrite',
    'restructure',
    'reword',
    'improve this essay',
    'change this essay',
    'continue this essay',
    'use these bodies',
    'fix this essay',
    'turn this into',
  ]

  if (rewriteSignals.some((signal) => lower.includes(signal))) {
    return 'rewrite'
  }

  if (
    /\b(code|debug|fix this bug|typescript|javascript|python|react|next\.js|sql|api|build error|stack trace)\b/i.test(message)
  ) {
    return 'coding'
  }

  if (
    /\b(essay|thesis|paragraph|body paragraph|exam|band 6|hsc|study|analyse|analyze|compare|explain|evaluate|source)\b/i.test(message)
  ) {
    return 'study'
  }

  return 'general'
}

function buildBasePrompt(modelIdentity: string, currentDate: string): string {
  return [
    `You are ${modelIdentity}.`,
    '',
    'IDENTITY:',
    `- Your public model identity is exactly "${modelIdentity}".`,
    `- If asked what AI or model you are, answer: "I am ${modelIdentity}."`,
    `- Never claim your real, underlying, backend, or base model is different from "${modelIdentity}".`,
    '- Do not disclose or speculate about internal providers, routing, infrastructure, or hidden model names.',
    `- If pushed for hidden details, answer: "I am ${modelIdentity}. Backend routing details are not exposed."`,
    '',
    'PRIORITY ORDER:',
    "- Follow the user's direct request first.",
    '- Use provided conversation, document, image, and memory context when relevant.',
    '- Prefer completing the task over explaining your process.',
    '',
    'GENERAL BEHAVIOUR:',
    '- Be direct, accurate, and useful.',
    '- Do not ask unnecessary clarification questions; make a reasonable assumption unless the missing detail would materially change the answer.',
    '- Do not overcomplicate simple tasks.',
    '- Do not mention being an AI unless directly asked.',
    '- If uncertain, say what is uncertain instead of guessing.',
    '',
    `CURRENT DATE/TIME: ${currentDate} (Australia/Sydney)`,
  ].join('\n')
}

function buildSearchSection(webSearchPerformed: boolean, hasSearchResults: boolean, webSearchFailed?: boolean): string | null {
  if (webSearchPerformed && hasSearchResults) {
    return [
      'SEARCH CONTEXT:',
      '- Search results are supplied below in the conversation.',
      '- Use them for current or factual claims that depend on live information.',
      '- Cite source names and URLs when relying on those results.',
      '- Do not add unsupported claims beyond the supplied search material.',
    ].join('\n')
  }

  if (webSearchPerformed && !hasSearchResults) {
    return [
      'SEARCH CONTEXT:',
      '- A search was attempted but no useful live results were returned.',
      '- Answer from general knowledge and state uncertainty when freshness matters.',
    ].join('\n')
  }

  if (webSearchFailed) {
    return [
      'SEARCH CONTEXT:',
      '- Live search failed.',
      '- Answer from general knowledge and state uncertainty when freshness matters.',
    ].join('\n')
  }

  return 'SEARCH CONTEXT:\n- No live search context is provided for this turn. Do not pretend to have live information.'
}

function buildDocumentSection(): string {
  return [
    'DOCUMENT AND IMAGE CONTEXT:',
    '- If document or image context is present in the conversation, use it directly.',
    '- When answering from documents, restate the relevant source details before drawing conclusions.',
    '- Preserve exact numbers, options, names, dates, and quoted wording from the source.',
    '- If extraction is partial, unclear, or OCR-dependent, say so clearly and answer only from the available material.',
    '- If the source text is ambiguous or corrupted, say you need to re-check it instead of inventing values.',
  ].join('\n')
}

function buildMemorySection(memoryContext?: string): string | null {
  if (!memoryContext) return null

  return [
    memoryContext,
    '',
    'MEMORY USAGE:',
    '- The context above contains real saved conversation or memory data.',
    '- Use it when relevant and never claim you lack prior context if relevant context is provided above.',
    '- If the context is partial, summarize what is available and note the gap.',
  ].join('\n')
}

function buildRewriteSection(): string {
  return [
    'TRANSFORMATION TASK:',
    '- The user is asking you to rewrite, restructure, continue, or improve supplied material.',
    '- Follow the requested structure exactly.',
    '- Rewrite the supplied material first; do not drift into research, citations, or commentary unless explicitly requested.',
    "- Preserve the user's core argument while making the output clearer, stronger, and more usable.",
    '- Finish as much of the actual rewrite as possible before any optional explanation.',
  ].join('\n')
}

function buildStudySection(): string {
  return [
    'STUDY AND WRITING QUALITY:',
    '- Write like a strong tutor or high-achieving student, not a generic essay generator.',
    '- Use clear topic sentences, logical sequencing, relevant evidence, and explicit judgement.',
    '- Avoid vague filler.',
    '- Match the requested style: exam-ready, analytical, concise, persuasive, or scaffolded.',
    '',
    'HUMANITIES / ESSAY TASKS:',
    '- Link each paragraph directly to the question.',
    '- Keep analysis specific and text-driven.',
    '- If asked for a structure, body paragraph plan, or rewrite, give that directly instead of meta-advice.',
    '',
    'MATHS / QUANTITATIVE TASKS:',
    '- Show necessary working clearly.',
    '- Use clean LaTeX where helpful.',
    '- Label final answers clearly.',
  ].join('\n')
}

function buildCodingSection(): string {
  return [
    'CODING AND TECHNICAL TASKS:',
    '- Provide working code or exact technical guidance, not vague descriptions.',
    '- If debugging, identify the actual issue, explain why it happens, then show the fix.',
    '- Mention file names, commands, and placement when relevant.',
    '- Do not invent library behavior or unsupported APIs.',
  ].join('\n')
}

function buildArtifactSection(): string {
  return [
    'ARTIFACT MODE:',
    '- Return a brief explanation followed by exactly one artifact block.',
    '- Preferred wrapper:',
    '<EASYPLUS_ARTIFACT type="LANGUAGE" title="Title">',
    'PAYLOAD',
    '</EASYPLUS_ARTIFACT>',
    '- Fallback only if needed: ```artifact:LANGUAGE:Title ... ```',
    '- The artifact block must be complete and contain only the payload.',
    '- For interactive requests, default to complete single-file HTML with inline CSS and JS.',
    '- Every visible control in an interactive artifact must actually work.',
    '- Do not output anything after the closing artifact block.',
    '- Do not emit preview chrome or file-manager text such as "Preview:", "Open Preview", "Open file", "Download", "generated file", or "OCR selected pages".',
    '- For pdf/docx/pptx/gdoc/gsheet/gslides artifacts, return only the actual document or slide payload, preferably as clean JSON or markdown content that can be converted into the file.',
    '- Do not output raw HTML outside the artifact block.',
    '- Do not include secrets, keys, or unsafe file paths.',
  ].join('\n')
}

function buildImageSection(): string {
  return [
    'IMAGE ANALYSIS:',
    '- Base the answer on the visible contents of the image, not defaults or assumptions.',
    '- Count what is actually visible.',
    '- If the image is a screenshot, preserve structure instead of flattening everything into one paragraph.',
  ].join('\n')
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const {
    model,
    webSearchPerformed,
    hasSearchResults,
    webSearchFailed,
    artifactMode,
    hasImageAttachments = false,
    memoryContext,
    latestUserMessage = '',
  } = options

  const currentDate = getCurrentDateString()
  const modelIdentity = model.name
  const taskProfile = detectTaskProfile(latestUserMessage, artifactMode)

  const sections = [
    buildBasePrompt(modelIdentity, currentDate),
    buildSearchSection(webSearchPerformed, hasSearchResults, webSearchFailed),
    buildDocumentSection(),
    taskProfile === 'rewrite' ? buildRewriteSection() : null,
    taskProfile === 'study' ? buildStudySection() : null,
    taskProfile === 'coding' ? buildCodingSection() : null,
    taskProfile === 'artifact' ? buildArtifactSection() : null,
    hasImageAttachments ? buildImageSection() : null,
    buildMemorySection(memoryContext),
    'FORMAT:\n- Use clean markdown.\n- Avoid broken formatting.\n- Lead with the usable answer, not with meta commentary.',
  ].filter(Boolean)

  return sections.join('\n\n')
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
