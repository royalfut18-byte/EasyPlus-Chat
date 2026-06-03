import type { Artifact } from '@/types/models'

const BUILDABLE_KEYWORDS = [
  'make', 'build', 'create', 'design', 'code', 'website', 'landing page',
  'html', 'css', 'react', 'component', 'game', 'dashboard', 'bracket',
  'calculator', 'app', 'ui', 'mockup', 'page', 'tool', 'generator',
  'form', 'chart', 'graph', 'animation', 'navigation', 'navbar', 'footer',
  'hero', 'section', 'layout', 'word', 'docx', 'excel', 'xlsx',
  'spreadsheet', 'sheet', 'sheets', 'powerpoint', 'ppt', 'pptx', 'slides',
  'presentation', 'google doc', 'google docs', 'google sheet', 'google sheets',
  'google slides', 'canva', 'deck', 'artifact', 'interactive', 'quiz',
  'timetable', 'revision', 'budget', 'table', 'widget', 'planner', 'schedule',
  'converter', 'tracker', 'simulator'
]

const SUPPORTED_LANGUAGES = new Set([
  'html', 'tsx', 'jsx', 'javascript', 'typescript', 'css', 'python', 'markdown', 'json', 'svg', 'text',
  'docx', 'xlsx', 'pptx', 'gdoc', 'gsheet', 'gslides', 'canva'
])

function normalizeLanguage(language?: string): Artifact['language'] | null {
  if (!language) return null

  const normalized = language.toLowerCase().trim()
  const aliasKey = normalized.replace(/[\s-]+/g, '_')
  const aliases: Record<string, Artifact['language']> = {
    htm: 'html',
    js: 'javascript',
    ts: 'typescript',
    typescript: 'typescript',
    react: 'tsx',
    py: 'python',
    md: 'markdown',
    markdown: 'markdown',
    json: 'json',
    svg: 'svg',
    txt: 'text',
    doc: 'docx',
    word: 'docx',
    docs: 'gdoc',
    google_doc: 'gdoc',
    google_docs: 'gdoc',
    excel: 'xlsx',
    spreadsheet: 'xlsx',
    sheet: 'gsheet',
    sheets: 'gsheet',
    google_sheet: 'gsheet',
    google_sheets: 'gsheet',
    powerpoint: 'pptx',
    ppt: 'pptx',
    presentation: 'pptx',
    slide: 'pptx',
    slides: 'gslides',
    google_slides: 'gslides',
    deck: 'pptx',
    design: 'canva',
    interactive_web: 'html',
    web_artifact: 'html',
    document: 'markdown',
    report: 'markdown',
  }

  const languageName = aliases[aliasKey] || aliases[normalized] || normalized
  return SUPPORTED_LANGUAGES.has(languageName)
    ? languageName as Artifact['language']
    : null
}

function containsBuildableIntent(userPrompt: string): boolean {
  const lowerPrompt = userPrompt.toLowerCase()
  return BUILDABLE_KEYWORDS.some(keyword => lowerPrompt.includes(keyword))
}

function generateTitleFromPrompt(prompt: string): string {
  if (!prompt.trim()) return 'Generated Artifact'

  let title = prompt
    .replace(/^(make me|build me|create|design|code|write|generate|show me|give me)\s+(a|an|the)?\s*/i, '')
    .trim()

  if (title.length > 50) {
    title = title.substring(0, 50)
    const lastSpace = title.lastIndexOf(' ')
    if (lastSpace > 20) {
      title = title.substring(0, lastSpace)
    }
  }

  title = title
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return title || 'Generated Artifact'
}

function generateTitleFromHtml(code: string, prompt?: string): string {
  const promptTitle = prompt ? generateTitleFromPrompt(prompt) : ''
  if (promptTitle && promptTitle !== 'Generated Artifact') return promptTitle

  const titleMatch = code.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch?.[1]
    ?.replace(/\s+/g, ' ')
    .trim()

  return title || 'HTML Artifact'
}

function inferLanguageFromCode(code: string, fallback?: string): Artifact['language'] {
  const explicitLanguage = normalizeLanguage(fallback)
  if (explicitLanguage) return explicitLanguage

  const trimmed = code.trim()
  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) return 'html'
  if (/^<svg[\s>]/i.test(trimmed)) return 'svg'
  if (/^[\[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // Fall through to other lightweight detection.
    }
  }
  if (/^#\s|\n#{1,6}\s|^\s*[-*]\s+/m.test(trimmed)) return 'markdown'
  return 'text'
}

function createArtifact(language: Artifact['language'], title: string, code: string): Artifact {
  return {
    id: `artifact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title: title.trim() || 'Generated Artifact',
    language,
    code: code.trim(),
    createdAt: new Date().toISOString(),
  }
}

function extractHtmlDocument(content: string): string | null {
  const startMatch = content.match(/<!DOCTYPE\s+html\b|<html[\s>]/i)
  if (!startMatch || startMatch.index === undefined) return null

  const start = startMatch.index
  const afterStart = content.slice(start)
  const endMatch = afterStart.match(/<\/html\s*>/i)

  if (endMatch?.index !== undefined) {
    return afterStart.slice(0, endMatch.index + endMatch[0].length)
  }

  // Some model responses get cut off before </html>. Still recover the
  // document so the user gets an artifact button instead of raw HTML text.
  return afterStart.trim()
}

function buildCleanContent(content: string, fullMatch: string, artifact: Artifact): string {
  const beforeArtifact = content.substring(0, content.indexOf(fullMatch)).trim()
  const afterArtifact = content.substring(content.indexOf(fullMatch) + fullMatch.length).trim()

  let cleanContent = ''
  if (beforeArtifact) {
    cleanContent += beforeArtifact + '\n\n'
  }
  const previewLabel = ['html', 'canva', 'markdown', 'json', 'svg', 'css', 'javascript', 'text', 'docx', 'gdoc', 'xlsx', 'gsheet', 'pptx', 'gslides'].includes(artifact.language)
    ? 'preview, edit, and download'
    : 'view, copy, and download'
  cleanContent += `**Artifact created: ${artifact.title}**\n\n_Open the artifact panel to ${previewLabel} it._`
  if (afterArtifact) {
    cleanContent += '\n\n' + afterArtifact
  }

  return cleanContent.trim() || `I created an artifact for you: **${artifact.title}**.`
}

export function parseArtifactFromResponse(
  content: string,
  artifactMode: boolean,
  userPrompt?: string
): {
  cleanContent: string
  artifact: Artifact | null
} {
  if (!artifactMode) {
    return { cleanContent: content, artifact: null }
  }

  // Explicit fenced format, with tolerance for model variations.
  const artifactBlockRegex = /```\s*artifact\s*[:\-]\s*([a-z0-9+#.-]+)\s*:\s*([^\n`]+)\r?\n([\s\S]*?)```/i
  const artifactMatch = content.match(artifactBlockRegex)

  if (artifactMatch) {
    const [fullMatch, language, title, code] = artifactMatch
    const artifact = createArtifact(inferLanguageFromCode(code, language), title, code)
    const cleanContent = buildCleanContent(content, fullMatch, artifact)

    return { cleanContent, artifact }
  }

  // Alternative non-markdown wrapper.
  const altArtifactRegex = /ARTIFACT_BLOCK_START\s*\r?\n\s*artifact\s*[:\-]\s*([a-z0-9+#.-]+)\s*:\s*([^\n]+)\r?\n([\s\S]*?)\r?\nARTIFACT_BLOCK_END/i
  const altArtifactMatch = content.match(altArtifactRegex)

  if (altArtifactMatch) {
    const [fullMatch, language, title, code] = altArtifactMatch
    const artifact = createArtifact(inferLanguageFromCode(code, language), title, code)
    const cleanContent = buildCleanContent(content, fullMatch, artifact)

    return { cleanContent, artifact }
  }

  // HTML code fence fallback. Handles complete and truncated HTML fences.
  const htmlFenceRegex = /```\s*(html|htm)[^\n`]*\r?\n([\s\S]*?)```/i
  const htmlFenceMatch = content.match(htmlFenceRegex)

  if (htmlFenceMatch) {
    const [fullMatch, , code] = htmlFenceMatch
    const artifact = createArtifact('html', generateTitleFromHtml(code, userPrompt), code)
    const cleanContent = buildCleanContent(content, fullMatch, artifact)

    return { cleanContent, artifact }
  }

  // Raw HTML document fallback for models that ignore artifact fences.
  // Handles complete documents and truncated responses missing </html>.
  const htmlDocument = extractHtmlDocument(content)

  if (htmlDocument) {
    const code = htmlDocument
    const artifact = createArtifact('html', generateTitleFromHtml(code, userPrompt), code)
    const cleanContent = buildCleanContent(content, htmlDocument, artifact)

    return { cleanContent, artifact }
  }

  // Normal code fence fallback. This is what prevents artifact mode from
  // degrading into a plain Markdown code block when the model forgets the
  // artifact: prefix.
  if (userPrompt && containsBuildableIntent(userPrompt)) {
    const codeFenceRegex = /```\s*([a-zA-Z0-9+#.-]+)?[^\n`]*\r?\n([\s\S]*?)```/
    const codeMatch = content.match(codeFenceRegex)

    if (codeMatch) {
      const [fullMatch, lang, code] = codeMatch
      const artifact = createArtifact(
        inferLanguageFromCode(code, lang),
        generateTitleFromPrompt(userPrompt),
        code
      )
      const cleanContent = buildCleanContent(content, fullMatch, artifact)

      return { cleanContent, artifact }
    }
  }

  return { cleanContent: content, artifact: null }
}

export function dedupeMessages<T extends { id: string; role: string; content: string; created_at: string }>(
  messages: T[]
): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const msg of messages) {
    if (!seen.has(msg.id)) {
      seen.add(msg.id)
      result.push(msg)
    }
  }

  return result
}
