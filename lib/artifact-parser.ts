import type { Artifact } from '@/types/models'

const BUILDABLE_KEYWORDS = [
  'make', 'build', 'create', 'design', 'code', 'website', 'landing page',
  'html', 'css', 'react', 'component', 'game', 'dashboard', 'bracket',
  'calculator', 'app', 'ui', 'mockup', 'page', 'tool', 'generator',
  'form', 'chart', 'graph', 'animation', 'navigation', 'navbar', 'footer',
  'hero', 'section', 'layout'
]

function containsBuildableIntent(userPrompt: string): boolean {
  const lowerPrompt = userPrompt.toLowerCase()
  return BUILDABLE_KEYWORDS.some(keyword => lowerPrompt.includes(keyword))
}

function generateTitleFromPrompt(prompt: string): string {
  const lowerPrompt = prompt.toLowerCase()

  // Remove common command words
  let title = prompt
    .replace(/^(make me|build me|create|design|code|write|generate|show me|give me)\s+(a|an|the)?\s*/i, '')
    .trim()

  // Take first 50 chars
  if (title.length > 50) {
    title = title.substring(0, 50)
    const lastSpace = title.lastIndexOf(' ')
    if (lastSpace > 20) {
      title = title.substring(0, lastSpace)
    }
  }

  // Capitalize
  title = title
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return title || 'Generated Artifact'
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

  // CASE A1: Explicit artifact block with markdown fence
  const artifactBlockRegex = /```artifact:(\w+):([^\n]+)\n([\s\S]*?)```/
  const artifactMatch = content.match(artifactBlockRegex)

  if (artifactMatch) {
    const [fullMatch, language, title, code] = artifactMatch

    const artifact: Artifact = {
      id: `artifact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: title.trim(),
      language: language as any,
      code: code.trim(),
      createdAt: new Date().toISOString(),
    }

    // Remove artifact block and replace with clean reference
    const beforeArtifact = content.substring(0, content.indexOf(fullMatch)).trim()
    const afterArtifact = content.substring(content.indexOf(fullMatch) + fullMatch.length).trim()

    let cleanContent = ''
    if (beforeArtifact) {
      cleanContent += beforeArtifact + '\n\n'
    }
    cleanContent += `**✨ Artifact created: ${artifact.title}**\n\n_The ${language} code is now available in the artifact panel on the right._`
    if (afterArtifact) {
      cleanContent += '\n\n' + afterArtifact
    }

    // Ensure cleanContent is never empty
    if (!cleanContent.trim()) {
      cleanContent = `I created an artifact for you: **${artifact.title}**.`
    }

    return { cleanContent, artifact }
  }

  // CASE A2: Alternative artifact block format (ARTIFACT_BLOCK_START/END)
  const altArtifactRegex = /ARTIFACT_BLOCK_START\s*\n\s*artifact:(\w+):([^\n]+)\n([\s\S]*?)\nARTIFACT_BLOCK_END/
  const altArtifactMatch = content.match(altArtifactRegex)

  if (altArtifactMatch) {
    const [fullMatch, language, title, code] = altArtifactMatch

    const artifact: Artifact = {
      id: `artifact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: title.trim(),
      language: language as any,
      code: code.trim(),
      createdAt: new Date().toISOString(),
    }

    // Remove artifact block and replace with clean reference
    const beforeArtifact = content.substring(0, content.indexOf(fullMatch)).trim()
    const afterArtifact = content.substring(content.indexOf(fullMatch) + fullMatch.length).trim()

    let cleanContent = ''
    if (beforeArtifact) {
      cleanContent += beforeArtifact + '\n\n'
    }
    cleanContent += `**✨ Artifact created: ${artifact.title}**\n\n_The ${language} code is now available in the artifact panel on the right._`
    if (afterArtifact) {
      cleanContent += '\n\n' + afterArtifact
    }

    // Ensure cleanContent is never empty
    if (!cleanContent.trim()) {
      cleanContent = `I created an artifact for you: **${artifact.title}**.`
    }

    return { cleanContent, artifact }
  }

  // CASE B: Raw full HTML document (fallback for models that don't follow instructions)
  const htmlDocRegex = /<!DOCTYPE\s+html[\s\S]*?<html[\s\S]*?<\/html>/i
  const htmlMatch = content.match(htmlDocRegex)

  if (htmlMatch && userPrompt && containsBuildableIntent(userPrompt)) {
    const code = htmlMatch[0]
    const title = generateTitleFromPrompt(userPrompt)

    const artifact: Artifact = {
      id: `artifact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title,
      language: 'html',
      code: code.trim(),
      createdAt: new Date().toISOString(),
    }

    // Remove the HTML and add reference
    const beforeHtml = content.substring(0, content.indexOf(htmlMatch[0])).trim()
    const afterHtml = content.substring(content.indexOf(htmlMatch[0]) + htmlMatch[0].length).trim()

    let cleanContent = ''
    if (beforeHtml) {
      cleanContent += beforeHtml + '\n\n'
    }
    cleanContent += `**✨ Artifact created: ${artifact.title}**\n\n_The interactive HTML page is now available in the artifact panel on the right._`
    if (afterHtml) {
      cleanContent += '\n\n' + afterHtml
    }

    // Ensure cleanContent is never empty
    if (!cleanContent.trim()) {
      cleanContent = `I created an artifact for you: **${artifact.title}**.`
    }

    return { cleanContent, artifact }
  }

  // CASE C: Normal code fence with buildable intent
  if (userPrompt && containsBuildableIntent(userPrompt)) {
    const codeFenceRegex = /```(html|tsx|jsx|javascript|js|css|python|py)\n([\s\S]*?)```/
    const codeMatch = content.match(codeFenceRegex)

    if (codeMatch) {
      const [fullMatch, lang, code] = codeMatch
      const language = lang === 'js' ? 'javascript' : lang === 'py' ? 'python' : lang
      const title = generateTitleFromPrompt(userPrompt)

      const artifact: Artifact = {
        id: `artifact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title,
        language: language as any,
        code: code.trim(),
        createdAt: new Date().toISOString(),
      }

      // Remove code fence and add reference
      const beforeCode = content.substring(0, content.indexOf(fullMatch)).trim()
      const afterCode = content.substring(content.indexOf(fullMatch) + fullMatch.length).trim()

      let cleanContent = ''
      if (beforeCode) {
        cleanContent += beforeCode + '\n\n'
      }
      cleanContent += `**✨ Artifact created: ${artifact.title}**\n\n_The ${language} code is now available in the artifact panel on the right._`
      if (afterCode) {
        cleanContent += '\n\n' + afterCode
      }

      // Ensure cleanContent is never empty
      if (!cleanContent.trim()) {
        cleanContent = `I created an artifact for you: **${artifact.title}**.`
      }

      return { cleanContent, artifact }
    }
  }

  // No artifact found
  return { cleanContent: content, artifact: null }
}

export function dedupeMessages<T extends { id: string; role: string; content: string; created_at: string }>(
  messages: T[]
): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const msg of messages) {
    // Dedupe by ID first
    if (!seen.has(msg.id)) {
      seen.add(msg.id)
      result.push(msg)
    }
  }

  return result
}
