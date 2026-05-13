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

  // Protect display math blocks ($$...$$)
  const displayMathBlocks: string[] = []
  cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
    displayMathBlocks.push(match)
    return `___DISPLAY_MATH___${displayMathBlocks.length - 1}`
  })

  // Protect inline math ($...$)
  const inlineMathBlocks: string[] = []
  cleaned = cleaned.replace(/\$(?!\d)([^$\n]+?)\$/g, (match) => {
    inlineMathBlocks.push(match)
    return `___INLINE_MATH___${inlineMathBlocks.length - 1}`
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

  // Restore protected content
  cleaned = cleaned.replace(/___INLINE_CODE___(\d+)/g, (_, i) => inlineCodeBlocks[parseInt(i)])
  cleaned = cleaned.replace(/___INLINE_MATH___(\d+)/g, (_, i) => inlineMathBlocks[parseInt(i)])
  cleaned = cleaned.replace(/___DISPLAY_MATH___(\d+)/g, (_, i) => displayMathBlocks[parseInt(i)])
  cleaned = cleaned.replace(new RegExp(`${CODE_BLOCK_PLACEHOLDER}(\\d+)`, 'g'), (_, i) => codeBlocks[parseInt(i)])
  cleaned = cleaned.replace(new RegExp(`${ARTIFACT_BLOCK_PLACEHOLDER}(\\d+)`, 'g'), (_, i) => artifactBlocks[parseInt(i)])

  return cleaned
}
