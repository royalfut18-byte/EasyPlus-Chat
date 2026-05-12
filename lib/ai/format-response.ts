const CODE_BLOCK_PLACEHOLDER = '___CODE_BLOCK___'
const ARTIFACT_BLOCK_PLACEHOLDER = '___ARTIFACT_BLOCK___'

export function cleanAssistantText(text: string): string {
  if (!text || text.length === 0) return text

  // Extract code blocks and artifact blocks to protect them
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

  // Protect inline code
  const inlineCodeBlocks: string[] = []
  cleaned = cleaned.replace(/`[^`\n]+`/g, (match) => {
    inlineCodeBlocks.push(match)
    return `___INLINE_CODE___${inlineCodeBlocks.length - 1}`
  })

  // Protect URLs
  const urls: string[] = []
  cleaned = cleaned.replace(/https?:\/\/[^\s)>\]]+/g, (match) => {
    urls.push(match)
    return `___URL___${urls.length - 1}`
  })

  // Protect markdown links [text](url)
  const mdLinks: string[] = []
  cleaned = cleaned.replace(/\[[^\]]*\]\([^)]*\)/g, (match) => {
    mdLinks.push(match)
    return `___MDLINK___${mdLinks.length - 1}`
  })

  // Fix 1: Add space after currency/number+slash+word when followed by lowercase letter
  // "$7/weekcut" -> "$7/week cut"
  cleaned = cleaned.replace(/(\$[\d,.]+\/\w+?)([a-z])/g, (match, prefix, nextChar) => {
    // Only split if the next char starts a new word (lowercase after full word)
    const lastWord = prefix.match(/\/(\w+)$/)?.[1] || ''
    if (lastWord.length >= 3 && /^[a-z]/.test(nextChar)) {
      return `${prefix} ${nextChar}`
    }
    return match
  })

  // Fix 2: Add space between number/comma-amount and following word
  // "45,000previously" -> "45,000 previously"
  // "$250Working" -> "$250 Working"
  cleaned = cleaned.replace(/(\d[\d,]*\.?\d*)([A-Za-z]{2,})/g, (match, num, word) => {
    // Don't split things like "100px", "2xl", "16px", "h264", common unit suffixes
    if (/^(px|em|rem|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|%|ms|s|kb|mb|gb|tb|xl|xs|sm|md|lg|k|m|b|th|st|nd|rd)$/i.test(word)) {
      return match
    }
    return `${num} ${word}`
  })

  // Fix 3: Add space between word ending with lowercase and next word starting uppercase
  // "earningover" - harder to catch generically, but common patterns:
  // "wordWord" where a lowercase letter directly precedes an uppercase
  // Only apply to runs of 8+ chars that look like crushed words
  cleaned = cleaned.replace(/([a-z]{3,})([A-Z][a-z]{2,})/g, '$1 $2')

  // Fix 4: Fix missing space after period/comma when followed by a letter (not abbreviations)
  // "measures.$250" -> "measures. $250" -- but careful with decimals
  cleaned = cleaned.replace(/([a-z])\.([A-Z])/g, '$1. $2')
  cleaned = cleaned.replace(/([a-z]),([A-Z])/g, '$1, $2')

  // Fix 5: Fix crushed emphasis boundaries
  // "text**bold**text" -> "text **bold** text" when no space around emphasis
  cleaned = cleaned.replace(/([a-zA-Z])\*\*([^*]+)\*\*([a-zA-Z])/g, '$1 **$2** $3')
  cleaned = cleaned.replace(/([a-zA-Z])\*([^*]+)\*([a-zA-Z])/g, '$1 *$2* $3')

  // Restore protected content
  cleaned = cleaned.replace(/___MDLINK___(\d+)/g, (_, i) => mdLinks[parseInt(i)])
  cleaned = cleaned.replace(/___URL___(\d+)/g, (_, i) => urls[parseInt(i)])
  cleaned = cleaned.replace(/___INLINE_CODE___(\d+)/g, (_, i) => inlineCodeBlocks[parseInt(i)])
  cleaned = cleaned.replace(new RegExp(`${CODE_BLOCK_PLACEHOLDER}(\\d+)`, 'g'), (_, i) => codeBlocks[parseInt(i)])
  cleaned = cleaned.replace(new RegExp(`${ARTIFACT_BLOCK_PLACEHOLDER}(\\d+)`, 'g'), (_, i) => artifactBlocks[parseInt(i)])

  return cleaned
}
