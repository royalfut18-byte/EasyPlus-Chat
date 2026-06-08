import fs from 'node:fs'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const promptSource = fs.readFileSync('lib/ai/system-prompt.ts', 'utf8')
const routeSource = fs.readFileSync('app/api/chat/route.ts', 'utf8')

assert(
  promptSource.includes('hasImageAttachments?: boolean'),
  'System prompt options must support image-aware prompt instructions'
)

assert(
  promptSource.includes('IMAGE ANALYSIS:'),
  'System prompt must include an image-analysis section'
)

assert(
  promptSource.includes('if an attached hand image visibly shows six fingers, answer six fingers, not five.'),
  'System prompt must include the six-finger hand guardrail'
)

assert(
  routeSource.includes('hasImageAttachments: hasCurrentImageAttachments'),
  'Chat route must pass current-image state into the system prompt builder'
)

console.log('PASS image-analysis system prompt includes visual counting guardrails and is wired into chat routing')
