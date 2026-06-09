import type { Artifact } from '@/types/models'
import { getGeneratedFileLabel, isGeneratedFileArtifactLanguage } from '@/lib/generated-files'
import { decodePossiblyEscapedText, parseGeneratedZipFromResponse } from '@/lib/generated-zip'

const BUILDABLE_KEYWORDS = [
  'make', 'build', 'create', 'design', 'code', 'website', 'landing page',
  'html', 'css', 'react', 'component', 'game', 'dashboard', 'bracket',
  'calculator', 'app', 'ui', 'mockup', 'page', 'tool', 'generator',
  'form', 'chart', 'graph', 'animation', 'navigation', 'navbar', 'footer',
  'hero', 'section', 'layout', 'artifact', 'interactive', 'quiz',
  'timetable', 'revision', 'budget', 'table', 'widget', 'planner', 'schedule',
  'converter', 'tracker', 'simulator', 'flashcard', 'timeline'
]

const SUPPORTED_LANGUAGES = new Set([
  'html', 'tsx', 'jsx', 'javascript', 'typescript', 'css', 'python', 'markdown', 'json', 'svg', 'text',
  'docx', 'xlsx', 'pptx', 'gdoc', 'gsheet', 'gslides', 'canva', 'pdf'
])

type ArtifactExtractionMethod = 'wrapper' | 'artifact_fence' | 'legacy_wrapper' | 'fenced_code' | 'raw_html' | 'inline_artifact' | 'none'

type ArtifactParseDiagnostics = {
  artifactIntentDetected: boolean
  artifactType: Artifact['language'] | null
  sourceLength: number
  extractionMethod: ArtifactExtractionMethod
  validationPassed: boolean
  repairAttempted: boolean
  repairSucceeded: boolean
  previewMode: 'iframe_srcdoc' | 'generated_file' | 'download_only' | 'none'
  runtimeError: string | null
}

type ArtifactValidationResult = {
  artifact: Artifact
  diagnostics: ArtifactParseDiagnostics
}

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
    pdf: 'pdf',
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
      // ignore
    }
  }
  if (/^#\s|\n#{1,6}\s|^\s*[-*]\s+/m.test(trimmed)) return 'markdown'
  return 'text'
}

function normalizeArtifactCode(language: Artifact['language'], code: string): string {
  const decoded = decodePossiblyEscapedText(code).replace(/\r\n/g, '\n').trim()

  if (language === 'html' || language === 'canva') return decoded
  if (language === 'text' || language === 'markdown') return decoded
  if (language === 'json' || language === 'svg') return decoded
  if (
    language === 'docx' ||
    language === 'gdoc' ||
    language === 'xlsx' ||
    language === 'gsheet' ||
    language === 'pptx' ||
    language === 'gslides' ||
    language === 'pdf'
  ) {
    return decoded
  }

  return decoded
}

function createArtifact(
  language: Artifact['language'],
  title: string,
  code: string,
  extractionMethod: ArtifactExtractionMethod
): Artifact {
  return {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    title: title.trim() || 'Generated Artifact',
    language,
    code: normalizeArtifactCode(language, code),
    extractionMethod: extractionMethod === 'none' ? undefined : extractionMethod,
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

  return afterStart.trim()
}

function extractHtmlLikeFragment(content: string): string | null {
  const trimmed = decodePossiblyEscapedText(content).trim()
  if (!trimmed) return null
  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return trimmed
  if (/^<(main|section|div|article|button|form|svg|style|script|canvas)\b/i.test(trimmed)) {
    return trimmed
  }
  return null
}

function getPreviewMode(language: Artifact['language'] | null): ArtifactParseDiagnostics['previewMode'] {
  if (!language) return 'none'
  if (isGeneratedFileArtifactLanguage(language)) return 'generated_file'
  if (['html', 'canva', 'markdown', 'json', 'svg', 'css', 'javascript', 'text'].includes(language)) return 'iframe_srcdoc'
  return 'download_only'
}

function createDiagnostics(
  language: Artifact['language'] | null,
  extractionMethod: ArtifactExtractionMethod,
  sourceLength: number
): ArtifactParseDiagnostics {
  return {
    artifactIntentDetected: false,
    artifactType: language,
    sourceLength,
    extractionMethod,
    validationPassed: false,
    repairAttempted: false,
    repairSucceeded: false,
    previewMode: getPreviewMode(language),
    runtimeError: null,
  }
}

function ensureHtmlDocument(title: string, code: string): { code: string; repaired: boolean } {
  let html = normalizeArtifactCode('html', code)
  let repaired = false
  const safeTitle = title.replace(/[<>&"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
  }[char] || char))

  if (!html) return { code: html, repaired }

  const looksLikeFullDocument = /^<!DOCTYPE\s+html/i.test(html) || /<html[\s>]/i.test(html)
  const looksLikeMarkup = /<\/?[a-z][\w:-]*[\s>]/i.test(html)

  if (!looksLikeFullDocument && looksLikeMarkup) {
    html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
</head>
<body>
${html}
</body>
</html>`
    repaired = true
  }

  if (/<html[\s>]/i.test(html) && !/<\/html\s*>/i.test(html)) {
    if (!/<\/body\s*>/i.test(html)) {
      html += '\n</body>'
    }
    html += '\n</html>'
    repaired = true
  }

  const tagPairs: Array<{ open: RegExp; close: RegExp; closingTag: string }> = [
    { open: /<script\b/gi, close: /<\/script>/gi, closingTag: '</script>' },
    { open: /<style\b/gi, close: /<\/style>/gi, closingTag: '</style>' },
  ]

  for (const pair of tagPairs) {
    const openCount = (html.match(pair.open) || []).length
    const closeCount = (html.match(pair.close) || []).length
    if (openCount > closeCount) {
      html += '\n' + pair.closingTag.repeat(openCount - closeCount)
      repaired = true
    }
  }

  return { code: html.trim(), repaired }
}

function collectMissingInlineHandlers(html: string): string[] {
  const handlerMatches = Array.from(
    html.matchAll(/\bon(?:click|change|submit|input|keydown|keyup)\s*=\s*["'][^"']*?([A-Za-z_$][\w$]*)\s*\(/gi)
  ).map((match) => match[1])

  if (handlerMatches.length === 0) return []

  const definedNames = new Set<string>()
  const definitionPatterns = [
    /function\s+([A-Za-z_$][\w$]*)\s*\(/gi,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/gi,
    /window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/gi,
  ]

  for (const pattern of definitionPatterns) {
    for (const match of html.matchAll(pattern)) {
      definedNames.add(match[1])
    }
  }

  return Array.from(new Set(handlerMatches)).filter((name) => !definedNames.has(name))
}

function validateArtifact(
  artifact: Artifact,
  userPrompt?: string,
  extractionMethod: ArtifactExtractionMethod = 'none'
): ArtifactValidationResult {
  const diagnostics = createDiagnostics(artifact.language, extractionMethod, artifact.code.length)
  diagnostics.artifactIntentDetected = !!userPrompt

  let nextArtifact: Artifact = {
    ...artifact,
    validationError: null,
    validationErrors: [],
    repaired: false,
  }
  const errors: string[] = []

  if (!nextArtifact.code.trim()) {
    errors.push('Artifact source is empty.')
  }

  if (nextArtifact.language === 'html' || nextArtifact.language === 'canva') {
    const repairResult = ensureHtmlDocument(nextArtifact.title, nextArtifact.code)
    diagnostics.repairAttempted = repairResult.repaired
    diagnostics.repairSucceeded = repairResult.repaired
    nextArtifact = {
      ...nextArtifact,
      code: repairResult.code,
      repaired: repairResult.repaired,
    }

    if (!/<(?:html|body|main|section|div|button|form|svg|canvas)\b/i.test(nextArtifact.code)) {
      errors.push('HTML artifact does not contain meaningful HTML structure.')
    }

    const missingHandlers = collectMissingInlineHandlers(nextArtifact.code)
    if (missingHandlers.length > 0) {
      errors.push(`Missing inline handler functions: ${missingHandlers.join(', ')}`)
    }

    const expectsInteractivity = /\b(interactive|quiz|calculator|flashcard|game|timeline|study tool)\b/i.test(String(userPrompt || ''))
      || /<(button|input|select|textarea|form)\b/i.test(nextArtifact.code)
      || /\bon(?:click|change|submit|input|keydown|keyup)\s*=/i.test(nextArtifact.code)

    if (expectsInteractivity && !/<script\b/i.test(nextArtifact.code) && missingHandlers.length > 0) {
      errors.push('Interactive HTML artifact is missing the JavaScript needed for its handlers.')
    }
  }

  diagnostics.validationPassed = errors.length === 0

  if (errors.length > 0) {
    nextArtifact.validationErrors = errors
    nextArtifact.validationError = errors[0]
  }

  return { artifact: nextArtifact, diagnostics }
}

function buildCleanContent(content: string, extractedBlock: string, artifact: Artifact): string {
  const index = content.indexOf(extractedBlock)
  const beforeArtifact = (index >= 0 ? content.substring(0, index) : '').trim()
  const afterArtifact = (index >= 0 ? content.substring(index + extractedBlock.length) : '').trim()

  let cleanContent = ''
  if (beforeArtifact) {
    cleanContent += beforeArtifact + '\n\n'
  }

  if (artifact.validationError) {
    cleanContent += `Artifact generation hit a validation issue for **${artifact.title}**.\n\n_Open the artifact panel to review the error and inspect the source._`
  } else if (isGeneratedFileArtifactLanguage(artifact.language)) {
    cleanContent += `I created a ${getGeneratedFileLabel(artifact.language)} for you: **${artifact.title}**.\n\n_Open the preview panel to review it. The real downloadable file is attached separately._`
  } else {
    cleanContent += `I created **${artifact.title}** for you.\n\n_Open the artifact panel to preview it, inspect the code, or download it._`
  }

  if (afterArtifact) {
    cleanContent += '\n\n' + afterArtifact
  }

  return cleanContent.trim() || (
    artifact.validationError
      ? `Artifact could not be generated correctly for **${artifact.title}**.`
      : `I created **${artifact.title}** for you.`
  )
}

function parseEasyPlusArtifactWrapper(content: string): { fullMatch: string; language: string; title: string; code: string } | null {
  const match = content.match(/<EASYPLUS_ARTIFACT\b([^>]*)>([\s\S]*?)<\/EASYPLUS_ARTIFACT>/i)
  if (!match) return null

  const attrs = match[1] || ''
  const code = match[2] || ''
  const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)
  const titleMatch = attrs.match(/\btitle\s*=\s*["']([^"']+)["']/i)

  return {
    fullMatch: match[0],
    language: typeMatch?.[1] || 'html',
    title: titleMatch?.[1] || 'Generated Artifact',
    code,
  }
}

function parseInlineArtifactBlock(content: string): { fullMatch: string; language: string; title: string; code: string } | null {
  const marker = /(?:^|\n)(artifact)\s*[:\-]\s*([a-z0-9+#.-]+)\s*:/i.exec(content)
  if (!marker || marker.index == null) return null

  const startIndex = content.slice(marker.index).startsWith('\n')
    ? marker.index + 1
    : marker.index
  const markerText = content.slice(startIndex, startIndex + marker[0].trimStart().length)
  const language = marker[2]
  const rest = content.slice(startIndex + markerText.length)
  if (!rest.trim()) return null

  const trimmedRest = rest.trimStart()
  let title = ''
  let code = ''

  if (/^[{\[]/.test(trimmedRest)) {
    title = 'Generated Artifact'
    code = trimmedRest
  } else {
    const newlineIndex = trimmedRest.indexOf('\n')
    const payloadStartCandidates = ['{', '[', '<']
      .map((char) => trimmedRest.indexOf(char))
      .filter((index) => index >= 0)
    const payloadStartIndex = payloadStartCandidates.length > 0
      ? Math.min(...payloadStartCandidates)
      : -1

    if (payloadStartIndex >= 0 && (newlineIndex === -1 || payloadStartIndex < newlineIndex)) {
      title = trimmedRest.slice(0, payloadStartIndex).trim()
      code = trimmedRest.slice(payloadStartIndex).trim()
    } else if (newlineIndex >= 0) {
      title = trimmedRest.slice(0, newlineIndex).trim()
      code = trimmedRest.slice(newlineIndex + 1).trim()
    } else {
      return null
    }
  }

  if (!code) return null

  return {
    fullMatch: content.slice(startIndex).trim(),
    language,
    title: title || 'Generated Artifact',
    code,
  }
}

export function parseArtifactFromResponse(
  content: string,
  artifactMode: boolean,
  userPrompt?: string
): {
  cleanContent: string
  artifact: Artifact | null
  diagnostics: ArtifactParseDiagnostics
} {
  const baseDiagnostics = createDiagnostics(null, 'none', content.length)
  baseDiagnostics.artifactIntentDetected = artifactMode || !!userPrompt

  if (!artifactMode) {
    return { cleanContent: content, artifact: null, diagnostics: baseDiagnostics }
  }

  const zipResult = parseGeneratedZipFromResponse(content)
  if (zipResult.manifest) {
    return { cleanContent: zipResult.cleanContent, artifact: null, diagnostics: baseDiagnostics }
  }

  const wrappedArtifact = parseEasyPlusArtifactWrapper(content)
  if (wrappedArtifact) {
    const artifact = createArtifact(
      inferLanguageFromCode(wrappedArtifact.code, wrappedArtifact.language),
      wrappedArtifact.title,
      wrappedArtifact.code,
      'wrapper'
    )
    const validated = validateArtifact(artifact, userPrompt, 'wrapper')
    return {
      cleanContent: buildCleanContent(content, wrappedArtifact.fullMatch, validated.artifact),
      artifact: validated.artifact,
      diagnostics: validated.diagnostics,
    }
  }

  const artifactBlockRegex = /```\s*artifact\s*[:\-]\s*([a-z0-9+#.-]+)\s*:\s*([^\n`]+)\r?\n([\s\S]*?)```/i
  const artifactMatch = content.match(artifactBlockRegex)

  if (artifactMatch) {
    const [fullMatch, language, title, code] = artifactMatch
    const artifact = createArtifact(inferLanguageFromCode(code, language), title, code, 'artifact_fence')
    const validated = validateArtifact(artifact, userPrompt, 'artifact_fence')
    return {
      cleanContent: buildCleanContent(content, fullMatch, validated.artifact),
      artifact: validated.artifact,
      diagnostics: validated.diagnostics,
    }
  }

  const inlineArtifact = parseInlineArtifactBlock(content)
  if (inlineArtifact) {
    const artifact = createArtifact(
      inferLanguageFromCode(inlineArtifact.code, inlineArtifact.language),
      inlineArtifact.title,
      inlineArtifact.code,
      'inline_artifact'
    )
    const validated = validateArtifact(artifact, userPrompt, 'inline_artifact')
    return {
      cleanContent: buildCleanContent(content, inlineArtifact.fullMatch, validated.artifact),
      artifact: validated.artifact,
      diagnostics: validated.diagnostics,
    }
  }

  const altArtifactRegex = /ARTIFACT_BLOCK_START\s*\r?\n\s*artifact\s*[:\-]\s*([a-z0-9+#.-]+)\s*:\s*([^\n]+)\r?\n([\s\S]*?)\r?\nARTIFACT_BLOCK_END/i
  const altArtifactMatch = content.match(altArtifactRegex)

  if (altArtifactMatch) {
    const [fullMatch, language, title, code] = altArtifactMatch
    const artifact = createArtifact(inferLanguageFromCode(code, language), title, code, 'legacy_wrapper')
    const validated = validateArtifact(artifact, userPrompt, 'legacy_wrapper')
    return {
      cleanContent: buildCleanContent(content, fullMatch, validated.artifact),
      artifact: validated.artifact,
      diagnostics: validated.diagnostics,
    }
  }

  const htmlFenceRegex = /```\s*(html|htm)[^\n`]*\r?\n([\s\S]*?)```/i
  const htmlFenceMatch = content.match(htmlFenceRegex)

  if (htmlFenceMatch) {
    const [fullMatch, , code] = htmlFenceMatch
    const artifact = createArtifact('html', generateTitleFromHtml(code, userPrompt), code, 'fenced_code')
    const validated = validateArtifact(artifact, userPrompt, 'fenced_code')
    return {
      cleanContent: buildCleanContent(content, fullMatch, validated.artifact),
      artifact: validated.artifact,
      diagnostics: validated.diagnostics,
    }
  }

  const htmlDocument = extractHtmlDocument(content)
  if (htmlDocument) {
    const artifact = createArtifact('html', generateTitleFromHtml(htmlDocument, userPrompt), htmlDocument, 'raw_html')
    const validated = validateArtifact(artifact, userPrompt, 'raw_html')
    return {
      cleanContent: buildCleanContent(content, htmlDocument, validated.artifact),
      artifact: validated.artifact,
      diagnostics: validated.diagnostics,
    }
  }

  const artifactIntentDetected = artifactMode || (userPrompt ? containsBuildableIntent(userPrompt) : false)
  if (artifactIntentDetected) {
    const genericFenceRegex = /```\s*(html|svg|markdown|md|jsx|tsx|javascript|typescript|css|json|text)?[^\n`]*\r?\n([\s\S]*?)```/i
    const genericFenceMatch = content.match(genericFenceRegex)

    if (genericFenceMatch) {
      const [fullMatch, lang, code] = genericFenceMatch
      const artifact = createArtifact(
        inferLanguageFromCode(code, lang),
        generateTitleFromPrompt(userPrompt || ''),
        code,
        'fenced_code'
      )
      const validated = validateArtifact(artifact, userPrompt, 'fenced_code')
      return {
        cleanContent: buildCleanContent(content, fullMatch, validated.artifact),
        artifact: validated.artifact,
        diagnostics: validated.diagnostics,
      }
    }

    const htmlFragment = extractHtmlLikeFragment(content)
    if (htmlFragment) {
      const artifact = createArtifact('html', generateTitleFromHtml(htmlFragment, userPrompt), htmlFragment, 'raw_html')
      const validated = validateArtifact(artifact, userPrompt, 'raw_html')
      return {
        cleanContent: buildCleanContent(content, htmlFragment, validated.artifact),
        artifact: validated.artifact,
        diagnostics: validated.diagnostics,
      }
    }
  }

  if (userPrompt && containsBuildableIntent(userPrompt)) {
    const codeFenceRegex = /```\s*([a-zA-Z0-9+#.-]+)?[^\n`]*\r?\n([\s\S]*?)```/
    const codeMatch = content.match(codeFenceRegex)

    if (codeMatch) {
      const [fullMatch, lang, code] = codeMatch
      const artifact = createArtifact(
        inferLanguageFromCode(code, lang),
        generateTitleFromPrompt(userPrompt),
        code,
        'fenced_code'
      )
      const validated = validateArtifact(artifact, userPrompt, 'fenced_code')
      return {
        cleanContent: buildCleanContent(content, fullMatch, validated.artifact),
        artifact: validated.artifact,
        diagnostics: validated.diagnostics,
      }
    }
  }

  return { cleanContent: content, artifact: null, diagnostics: baseDiagnostics }
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
