import fs from 'node:fs'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const contextBuilderSource = fs.readFileSync('lib/ai/context-builder.ts', 'utf8')
const promptSource = fs.readFileSync('lib/ai/system-prompt.ts', 'utf8')

const regexMatch = contextBuilderSource.match(
  /export function isDocumentFollowUpRequest\(message: string\): boolean \{\s*return (\/[\s\S]+?\/i)\.test\(message\)\s*\}/
)

assert(regexMatch, 'Could not find isDocumentFollowUpRequest regex')

const followUpRegex = Function(`return ${regexMatch[1]}`)()

for (const phrase of [
  'do question 2',
  'do question 3',
  'next question',
  'the PDF',
  'what PDF did I upload?',
]) {
  assert(followUpRegex.test(phrase), `Expected follow-up phrase to match: ${phrase}`)
}

assert(!followUpRegex.test('hello, how are you?'), 'Unrelated message should not trigger document follow-up')
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
