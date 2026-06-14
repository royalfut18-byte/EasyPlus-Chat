const CODE_BLOCK_PLACEHOLDER = '___CODE_BLOCK___'
const ARTIFACT_BLOCK_PLACEHOLDER = '___ARTIFACT_BLOCK___'
const CURRENCY_PLACEHOLDER = '___CURRENCY_'
const CURRENCY_PLACEHOLDER_SUFFIX = '___'

const CURRENCY_PATTERN = /(^|[^\\])\$((?:\d{1,3}(?:[,\s']\d{3})+|\d+)(?:\.\d+)?)(?=$|[\s);:!?}\]]|,(?!\d)|\.(?!\d))/g
const INLINE_MATH_CANDIDATE_PATTERN = /\$((?:\d+(?:[.,]\d+)?)|(?:[A-Za-z])|(?:[^$\n]*\\[^$\n]*)|(?:[^$\n]*[=<>≈≤≥+\-*/×÷^_][^$\n]*))\$/g
const SIMPLE_INLINE_MATH_PATTERN = /^[A-Za-z0-9\s.,()/%=<>≈≤≥+\-*/×÷^_:]+$/

function escapeUnescapedDollarSigns(value: string): string {
  return value.replace(/(^|[^\\])\$/g, '$1\\$')
}

function looksLikeInlineMath(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false
  if (/[=<>≈≤≥+\-*/×÷:]$/.test(trimmed)) return false

  if (/[\\^_{}]/.test(trimmed)) return true
  if (/[a-zA-Z]\s*[=<>+\-*/]/.test(trimmed)) return true
  if (/[a-zA-Z]{2,}\s*[({]/.test(trimmed)) return true

  // Preserve model output like "$8.8$", "$20$", "$A$", or "$241.875 × 0.02$".
  if (/^[A-Za-z]$/.test(trimmed)) return true
  if (/^\d+(?:[.,]\d+)?$/.test(trimmed)) return true
  if (
    SIMPLE_INLINE_MATH_PATTERN.test(trimmed) &&
    (
      (!/[A-Za-z]/.test(trimmed) && /\d/.test(trimmed)) ||
      /[=<>≈≤≥+\-*/×÷^_]/.test(trimmed)
    )
  ) {
    return true
  }

  return false
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
  // Match $...$ where content looks like LaTeX or a compact numeric/equation fragment.
  const inlineMathBlocks: string[] = []
  cleaned = cleaned.replace(INLINE_MATH_CANDIDATE_PATTERN, (match, content) => {
    if (looksLikeInlineMath(content)) {
      inlineMathBlocks.push(match)
      return `___INLINE_MATH___${inlineMathBlocks.length - 1}`
    }
    return match
  })

  // Protect standalone currency after inline math is reserved, so prices like
  // "$140 deposit" stay as text while paired fragments like "$8.8$" render as math.
  cleaned = cleaned.replace(CURRENCY_PATTERN, (_match, prefix: string, amount: string) => {
    currencyBlocks.push(`$${amount}`)
    return `${prefix}${CURRENCY_PLACEHOLDER}${currencyBlocks.length - 1}${CURRENCY_PLACEHOLDER_SUFFIX}`
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
