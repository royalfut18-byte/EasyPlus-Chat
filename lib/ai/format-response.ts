const PLACEHOLDER_START = '\uE000'
const PLACEHOLDER_END = '\uE001'
const INLINE_CODE_TAG = 'INLINE_CODE'
const DISPLAY_MATH_TAG = 'DISPLAY_MATH'
const INLINE_MATH_TAG = 'INLINE_MATH'
const CODE_BLOCK_TAG = 'CODE_BLOCK'
const ARTIFACT_BLOCK_TAG = 'ARTIFACT_BLOCK'
const CURRENCY_TAG = 'CURRENCY'

const CURRENCY_PATTERN = /(^|[^\\])\$((?:\d{1,3}(?:[,\s']\d{3})+|\d+)(?:\.\d+)?)(?=$|[\s);:!?}\]]|,(?!\d)|\.(?!\d))/g
const INLINE_MATH_CANDIDATE_PATTERN = /\$((?:\d+(?:[.,]\d+)?)|(?:[A-Za-z])|(?:[^$\n]*\\[^$\n]*)|(?:[^$\n]*[=<>≈≤≥+\-*/×÷^_][^$\n]*))\$/g
const SIMPLE_INLINE_MATH_PATTERN = /^[A-Za-z0-9\s.,()/%=<>≈≤≥+\-*/×÷^_:]+$/

function escapeUnescapedDollarSigns(value: string): string {
  return value.replace(/(^|[^\\])\$/g, '$1\\$')
}

function createPlaceholder(tag: string, index: number): string {
  return `${PLACEHOLDER_START}${tag}_${index}${PLACEHOLDER_END}`
}

function restorePlaceholders(
  value: string,
  tag: string,
  items: string[],
  transform?: (item: string) => string
): string {
  const pattern = new RegExp(`${PLACEHOLDER_START}${tag}_(\\d+)${PLACEHOLDER_END}`, 'g')
  return value.replace(pattern, (match, indexText) => {
    const item = items[Number.parseInt(indexText, 10)]
    if (typeof item !== 'string') return match
    return transform ? transform(item) : item
  })
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
    return createPlaceholder(ARTIFACT_BLOCK_TAG, artifactBlocks.length - 1)
  })

  // Protect fenced code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return createPlaceholder(CODE_BLOCK_TAG, codeBlocks.length - 1)
  })

  // Protect inline code
  const inlineCodeBlocks: string[] = []
  cleaned = cleaned.replace(/`[^`\n]+`/g, (match) => {
    inlineCodeBlocks.push(match)
    return createPlaceholder(INLINE_CODE_TAG, inlineCodeBlocks.length - 1)
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
    return createPlaceholder(DISPLAY_MATH_TAG, displayMathBlocks.length - 1)
  })

  // Protect inline math blocks ($...$) where content looks like LaTeX
  // Match $...$ where content looks like LaTeX or a compact numeric/equation fragment.
  const inlineMathBlocks: string[] = []
  cleaned = cleaned.replace(INLINE_MATH_CANDIDATE_PATTERN, (match, content) => {
    if (looksLikeInlineMath(content)) {
      inlineMathBlocks.push(match)
      return createPlaceholder(INLINE_MATH_TAG, inlineMathBlocks.length - 1)
    }
    return match
  })

  // Protect standalone currency after inline math is reserved, so prices like
  // "$140 deposit" stay as text while paired fragments like "$8.8$" render as math.
  cleaned = cleaned.replace(CURRENCY_PATTERN, (_match, prefix: string, amount: string) => {
    currencyBlocks.push(`$${amount}`)
    return `${prefix}${createPlaceholder(CURRENCY_TAG, currencyBlocks.length - 1)}`
  })

  // Only safe fix: add space after period/comma before uppercase (sentence boundaries)
  cleaned = cleaned.replace(/([a-z])\.([A-Z])/g, '$1. $2')
  cleaned = cleaned.replace(/([a-z]),([A-Z])/g, '$1, $2')

  // Anything not explicitly protected as math should reach markdown as text.
  cleaned = escapeUnescapedDollarSigns(cleaned)

  // Restore protected content in correct order (reverse of protection)
  // Restore currency escaped for markdown so remark-math cannot parse it.
  cleaned = restorePlaceholders(cleaned, CURRENCY_TAG, currencyBlocks, escapeUnescapedDollarSigns)

  // Restore math
  cleaned = restorePlaceholders(cleaned, INLINE_MATH_TAG, inlineMathBlocks)
  cleaned = restorePlaceholders(cleaned, DISPLAY_MATH_TAG, displayMathBlocks)

  // Restore code
  cleaned = restorePlaceholders(cleaned, INLINE_CODE_TAG, inlineCodeBlocks)
  cleaned = restorePlaceholders(cleaned, CODE_BLOCK_TAG, codeBlocks)
  cleaned = restorePlaceholders(cleaned, ARTIFACT_BLOCK_TAG, artifactBlocks)

  return cleaned
}
