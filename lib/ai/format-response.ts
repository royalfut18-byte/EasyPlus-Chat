const CODE_BLOCK_PLACEHOLDER = '___CODE_BLOCK___'
const ARTIFACT_BLOCK_PLACEHOLDER = '___ARTIFACT_BLOCK___'
const CURRENCY_PLACEHOLDER = '___CURRENCY_'
const CURRENCY_PLACEHOLDER_SUFFIX = '___'

const CURRENCY_PATTERN = /(^|[^\\])\$((?:\d{1,3}(?:[,\s']\d{3})+|\d+)(?:\.\d+)?)/g

function escapeUnescapedDollarSigns(value: string): string {
  return value.replace(/(^|[^\\])\$/g, '$1\\$')
}

export function cleanAssistantText(text: string): string {
  if (!text || text.length === 0) return text

  const codeBlocks: string[] = []
  const artifactBlocks: string[] = []
  const currencyBlocks: string[] = []

  let cleaned = text

  // Protect artifact blocks first
  cleaned = cleaned.replace(/```artifact:[^\n]*\n[\s\S]*?```/g, (match) => {
    artifactBlocks.push(match)
    return `${ARTIFACT_BLOCK_PLACEHOLDER}${artifactBlocks.length - 1}`
  })

  // Protect fenced code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `${CODE_BLOCK_PLACEHOLDER}${codeBlocks.length - 1}`
  })

  // Protect inline code
  const inlineCodeBlocks: string[] = []
  cleaned = cleaned.replace(/`[^`\n]+`/g, (match) => {
    inlineCodeBlocks.push(match)
    return `___INLINE_CODE___${inlineCodeBlocks.length - 1}`
  })

  // Protect currency before math detection so "$100,000 ... $A = P$" still
  // leaves the later math expression available to remark-math.
  cleaned = cleaned.replace(CURRENCY_PATTERN, (_match, prefix: string, amount: string) => {
    currencyBlocks.push(`$${amount}`)
    return `${prefix}${CURRENCY_PLACEHOLDER}${currencyBlocks.length - 1}${CURRENCY_PLACEHOLDER_SUFFIX}`
  })

  // Convert LaTeX-style delimiters to dollar-sign delimiters
  // \(...\) → $...$ (inline math)
  cleaned = cleaned.replace(/\\\((.+?)\\\)/g, (_match, content) => `$${content}$`)
  // \[...\] → $$...$$ display math (on own line)
  cleaned = cleaned.replace(/\\\[([\s\S]+?)\\\]/g, (_match, content) => `\n$$\n${content.trim()}\n$$\n`)

  // Protect display math blocks ($$...$$)
  const displayMathBlocks: string[] = []
  cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
    displayMathBlocks.push(match)
    return `___DISPLAY_MATH___${displayMathBlocks.length - 1}`
  })

  // Protect inline math blocks ($...$) where content looks like LaTeX
  // Match $...$ where content contains backslash, ^, _, {}, or letters with operators
  const inlineMathBlocks: string[] = []
  cleaned = cleaned.replace(/\$([^$\n]+)\$/g, (match, content) => {
    const looksLikeMath = /[\\^_{}]|[a-zA-Z]\s*[=<>+\-*/]|[a-zA-Z]{2,}\s*[({]/.test(content)
    if (looksLikeMath) {
      inlineMathBlocks.push(match)
      return `___INLINE_MATH___${inlineMathBlocks.length - 1}`
    }
    return match
  })

  // Only safe fix: add space after period/comma before uppercase (sentence boundaries)
  cleaned = cleaned.replace(/([a-z])\.([A-Z])/g, '$1. $2')
  cleaned = cleaned.replace(/([a-z]),([A-Z])/g, '$1, $2')

  // Anything not explicitly protected as math should reach markdown as text.
  cleaned = escapeUnescapedDollarSigns(cleaned)

  // Restore protected content in correct order (reverse of protection)
  // Restore currency escaped for markdown so remark-math cannot parse it.
  cleaned = cleaned.replace(new RegExp(`${CURRENCY_PLACEHOLDER}(\\d+)${CURRENCY_PLACEHOLDER_SUFFIX}`, 'g'), (match, i) => {
    const currency = currencyBlocks[Number.parseInt(i, 10)]
    return currency ? escapeUnescapedDollarSigns(currency) : match
  })

  // Restore math
  cleaned = cleaned.replace(/___INLINE_MATH___(\d+)/g, (match, i) => inlineMathBlocks[parseInt(i)] ?? match)
  cleaned = cleaned.replace(/___DISPLAY_MATH___(\d+)/g, (match, i) => displayMathBlocks[parseInt(i)] ?? match)

  // Restore code
  cleaned = cleaned.replace(/___INLINE_CODE___(\d+)/g, (match, i) => inlineCodeBlocks[parseInt(i)] ?? match)
  cleaned = cleaned.replace(new RegExp(`${CODE_BLOCK_PLACEHOLDER}(\\d+)`, 'g'), (match, i) => codeBlocks[parseInt(i)] ?? match)
  cleaned = cleaned.replace(new RegExp(`${ARTIFACT_BLOCK_PLACEHOLDER}(\\d+)`, 'g'), (match, i) => artifactBlocks[parseInt(i)] ?? match)

  return cleaned
}
