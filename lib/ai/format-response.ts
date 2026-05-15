const CODE_BLOCK_PLACEHOLDER = '___CODE_BLOCK___'
const ARTIFACT_BLOCK_PLACEHOLDER = '___ARTIFACT_BLOCK___'

export function cleanAssistantText(text: string): string {
  if (!text || text.length === 0) return text

  const codeBlocks: string[] = []
  const artifactBlocks: string[] = []

  let cleaned = text

  // Protect artifact blocks
  cleaned = cleaned.replace(/```artifact:[^\n]*\n[\s\S]*?```/g, (match) => {
    artifactBlocks.push(match)
    return `${ARTIFACT_BLOCK_PLACEHOLDER}${artifactBlocks.length - 1}`
  })

  // Protect fenced code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `${CODE_BLOCK_PLACEHOLDER}${codeBlocks.length - 1}`
  })

  // Convert LaTeX-style delimiters to $$...$$ before math protection
  // \(...\) → $$...$$ (inline math)
  cleaned = cleaned.replace(/\\\((.+?)\\\)/g, (_match, content) => `$$${content}$$`)
  // \[...\] → display math (on own line)
  cleaned = cleaned.replace(/\\\[([\s\S]+?)\\\]/g, (_match, content) => `\n$$\n${content.trim()}\n$$\n`)

  // Protect display math blocks ($$...$$)
  const displayMathBlocks: string[] = []
  cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
    displayMathBlocks.push(match)
    return `___DISPLAY_MATH___${displayMathBlocks.length - 1}`
  })

  // Protect inline code
  const inlineCodeBlocks: string[] = []
  cleaned = cleaned.replace(/`[^`\n]+`/g, (match) => {
    inlineCodeBlocks.push(match)
    return `___INLINE_CODE___${inlineCodeBlocks.length - 1}`
  })

  // Only safe fix: add space after period/comma before uppercase (sentence boundaries)
  cleaned = cleaned.replace(/([a-z])\.([A-Z])/g, '$1. $2')
  cleaned = cleaned.replace(/([a-z]),([A-Z])/g, '$1, $2')

  // Restore protected content (with safety fallback to prevent "undefined")
  cleaned = cleaned.replace(/___INLINE_CODE___(\d+)/g, (match, i) => inlineCodeBlocks[parseInt(i)] ?? match)
  cleaned = cleaned.replace(/___DISPLAY_MATH___(\d+)/g, (match, i) => displayMathBlocks[parseInt(i)] ?? match)
  cleaned = cleaned.replace(new RegExp(`${CODE_BLOCK_PLACEHOLDER}(\\d+)`, 'g'), (match, i) => codeBlocks[parseInt(i)] ?? match)
  cleaned = cleaned.replace(new RegExp(`${ARTIFACT_BLOCK_PLACEHOLDER}(\\d+)`, 'g'), (match, i) => artifactBlocks[parseInt(i)] ?? match)

  return cleaned
}
