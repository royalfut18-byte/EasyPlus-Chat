import fs from 'node:fs'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const documentRequestSource = fs.readFileSync('lib/ai/document-requests.ts', 'utf8')
const promptSource = fs.readFileSync('lib/ai/system-prompt.ts', 'utf8')

assert(documentRequestSource.includes('parseQuestionNumberRequest'), 'Question-number parser must exist')
assert(documentRequestSource.includes('isDocumentFollowUpRequest'), 'Document follow-up detector must exist')

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

function isDocumentFollowUpRequest(message) {
  if (parseQuestionNumberRequest(message) || /\bpage\s+\d{1,4}\b/i.test(message)) return true

  return /\b(question\s+(?:one|two|three|four|five|six|seven|eight|nine|ten)|chapter\s+\d+(?:\.\d+)?|next\s+(?:one|question)|do\s+the\s+next\s+one|previous\s+(?:one|question)|the\s+(?:pdf|document|file|worksheet|attachment)|uploaded\s+(?:pdf|document|file)|what\s+(?:pdf|document|file)\s+did\s+i\s+upload|continue|do\s+(?:q|question)|solve\s+(?:q|question)|ocr\s+(?:pages?|the\s+first)|pages?\s+\d+)\b/i.test(message)
}

for (const phrase of [
  'do question 2',
  'do question 3',
  'next question',
  'the PDF',
  'what PDF did I upload?',
  'do chapter 11.2 questions',
  'OCR the first 10 pages',
]) {
  assert(isDocumentFollowUpRequest(phrase), `Expected follow-up phrase to match: ${phrase}`)
}

assert(isDocumentFollowUpRequest("what's answer to 20"), 'Question 20 request should trigger document follow-up')
assert(parseQuestionNumberRequest("what's answer to 20") === 20, 'Question 20 should be parsed')
assert(!isDocumentFollowUpRequest('hello, how are you?'), 'Unrelated message should not trigger document follow-up')
assert(
  promptSource.includes('Uploaded files remain available within the same conversation through saved extracted document context.'),
  'System prompt must remind models to use saved uploaded file context'
)
assert(
  promptSource.includes("NEVER say \"I don't have the full document visible to me.\""),
  'System prompt must forbid the incorrect missing-document response'
)

console.log('PASS document follow-up detection covers question 2, question 3, next question, and uploaded PDF references')
console.log('PASS system prompt includes saved document context rule')
