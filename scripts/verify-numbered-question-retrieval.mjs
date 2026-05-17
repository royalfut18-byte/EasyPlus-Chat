function parseQuestionNumberRequest(message) {
  const normalized = message
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

  const patterns = [
    /\bq(?:uestion)?\s*#?\s*(\d{1,3})\b/i,
    /\b(?:do|solve|answer|explain|calculate|find|work\s*out|help\s+with)\s+(?:the\s+)?(?:question\s+|q\s*)?(\d{1,3})\b/i,
    /\bwhat(?:'s| is)?\s+(?:the\s+)?answer\s+(?:to|for)\s+(?:question\s+|q\s*)?(\d{1,3})\b/i,
    /\b(?:answer|solution)\s+(?:to|for)\s+(?:question\s+|q\s*)?(\d{1,3})\b/i,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (!match) continue
    const questionNumber = Number.parseInt(match[1], 10)
    if (Number.isFinite(questionNumber) && questionNumber > 0 && questionNumber < 1000) {
      return questionNumber
    }
  }
  return null
}

function questionStartPatterns(questionNumber) {
  const n = String(questionNumber)
  return [
    new RegExp(`(?:^|[\\r\\n])\\s*(?:question\\s+|q\\s*)?${n}\\s*[\\).:\\-]`, 'i'),
    new RegExp(`\\b(?:question|q)\\s*${n}\\b`, 'i'),
    new RegExp(`(?:^|[\\r\\n])\\s*${n}\\s+`, 'i'),
  ]
}

function findQuestionNumberIndex(text, questionNumber) {
  let bestIndex = -1
  for (const pattern of questionStartPatterns(questionNumber)) {
    const match = pattern.exec(text)
    if (!match) continue
    if (bestIndex === -1 || match.index < bestIndex) bestIndex = match.index
  }
  return bestIndex
}

function extractQuestionNumberExcerpt(text, questionNumber, maxChars = 3600) {
  const matchIndex = findQuestionNumberIndex(text, questionNumber)
  if (matchIndex < 0) return null
  const nextIndex = findQuestionNumberIndex(text.slice(matchIndex + 1), questionNumber + 1)
  const naturalEnd = nextIndex >= 0 ? matchIndex + 1 + nextIndex : matchIndex + maxChars
  return text.slice(Math.max(0, matchIndex - 250), Math.min(text.length, naturalEnd, matchIndex + maxChars)).trim()
}

const extractedPdfText = `
1. Sally purchased an electronic game machine on hire purchase. She paid $140 deposit and then $25.50 per month for two years.
A. $191
B. $446
C. $612
D. $752

${Array.from({ length: 18 }, (_, index) => `${index + 2}. Filler annuities question ${index + 2}.`).join('\n')}

20. Andrew borrowed $20,000 to buy a car. He repaid the loan by paying $243 per month for 10 years. After 4 years he increased the repayment to $281 per month and paid off the loan one year earlier. How much less did Andrew pay?
21. Another unrelated question.
`

const query = "what's answer to 20"
const questionNumber = parseQuestionNumberRequest(query)
if (questionNumber !== 20) {
  throw new Error(`Expected question number 20, got ${questionNumber}`)
}

const excerpt = extractQuestionNumberExcerpt(extractedPdfText, questionNumber)
if (!excerpt || !excerpt.includes('Andrew borrowed $20,000') || !excerpt.includes('$243') || !excerpt.includes('$281')) {
  throw new Error(`Question 20 excerpt was not retrieved correctly: ${excerpt}`)
}

const originalTotal = 243 * 120
const newTotal = 243 * 48 + 281 * 60
const difference = originalTotal - newTotal
if (originalTotal !== 29160 || newTotal !== 28524 || difference !== 636) {
  throw new Error(`Unexpected Q20 calculation: ${originalTotal}, ${newTotal}, ${difference}`)
}

console.log('Numbered question retrieval verified:', {
  query,
  questionNumber,
  foundQuestion20: true,
  originalTotal,
  newTotal,
  difference,
})
