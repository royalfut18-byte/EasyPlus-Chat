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

If document or image context is provided, use it to answer the user's question.

DOCUMENT-BASED ANSWERING - CRITICAL RULES:
- When answering from attached documents, ALWAYS quote or restate the relevant details from the document first.
- For example: "From the document, Sally paid a $140 deposit and $25.50 per month for two years."
- Uploaded files remain available within the same conversation through saved extracted document context.
- If uploaded file context is present, NEVER say "I don't have the full document visible to me."
- For follow-up requests like "question 2", "next question", or "do question 3", find that question in the saved document context and answer from it.
- If extraction is partial, state which document text is available and answer only from that available text.
- If a PDF is marked scanned/image-only or OCR needed, do not say you cannot read it. Ask for the relevant page range, or offer to OCR the first pages/table of contents to locate the requested chapter.
- If OCR text is provided for selected pages, treat it as document context and answer from it.
- NEVER change numbers or values from the source. Use the exact numbers provided in the document.
- When answering a multiple choice question from a document:
  * First, identify the exact question number.
  * Extract and restate the full question including ALL answer options.
  * Use only the values provided in the document for any calculations.
  * Final answer MUST match exactly one of the listed options.
  * Do NOT invent or modify numbers.
- If extracted details are unclear or seem corrupted (e.g., expected values are missing), say so: "I need to re-check the question text because the extracted numbers are unclear."
- NEVER proceed with calculations based on uncertain or missing source values.
- Ground every answer from documents in the actual source text.`

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
- Use inline math with $...$ for short expressions (e.g. $u = \sec\theta$).
- Use display math with $$...$$ on its own line for equations and multi-step working.
- For finance/maths word problems, use currency as plain text.
- Do not wrap currency amounts in math delimiters.
- For example, write "$140" as literal currency, not as LaTeX math.
- Never write display equations as plain multiline stacked characters (one symbol per line).
- Write fractions as \frac{}{}, integrals as \int, powers as ^{}, subscripts as _{}.
- Label final answers clearly.
- Do not use raw unclosed dollar signs.

Use clean markdown. Do not output broken formatting.`

  if (memoryContext) {
    prompt += `

${memoryContext}

MEMORY AND CONTEXT INSTRUCTIONS:
- The context sections above contain real information from this user's conversations and saved memories.
- When the user asks "what do you know about..." or "what do you remember about..." — answer using ALL context provided above.
- NEVER say "I don't have access to previous conversations" or "I don't have any stored information" if ANY context sections above contain relevant information.
- If the user references something from earlier (a file, image, instruction, or topic), answer using the provided context.
- Summarize what you know from the context naturally. Be specific about what information is available.
- If context is partial or incomplete, say what you do know and note what may be missing.
- Only say you lack information if NONE of the context sections above contain anything relevant to the user's question.`
  }

  if (artifactMode) {
    prompt += `

ARTIFACT MODE:
When the user asks for something to make, build, design, preview, or display in the side panel, return a brief explanation then one artifact block:

\`\`\`artifact:LANGUAGE:Title
CODE_HERE
\`\`\`

Languages: html, tsx, jsx, javascript, css, python, markdown, text, docx, xlsx, pptx, gdoc, gsheet, gslides, canva.
Default to artifact:html with complete single-file HTML, inline CSS, and inline JS so the app can show a live side-panel preview.
Only use docx, xlsx, pptx, gdoc, gsheet, or gslides when the user explicitly asks for that exact Office/Google file type.
Do not choose Word/docx for generic requests like "make something", "make an artifact", "make a document", "write this up", or "create a page". Use html unless the user clearly asks for a Word document or .docx file.
For explicit Microsoft Word requests, use language docx and write clean markdown/plain text. The app will convert it into a downloadable .docx file.
For explicit Excel or Google Sheets requests, use language xlsx or gsheet and write CSV/markdown-table content. The app will convert it into a downloadable .xlsx file.
For explicit PowerPoint or Google Slides requests, use language pptx or gslides and write slide content separated by --- lines. The app will convert it into a downloadable .pptx file.
For explicit Google Docs requests, use language gdoc and write clean markdown/plain text. The app will convert it into a downloadable .docx file.
For Canva-style designs, use language canva and provide complete HTML/CSS for the design. The app will preview it and download it as an .html file, because Canva has no open native file format.
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
