import fs from 'node:fs'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const promptSource = fs.readFileSync('lib/ai/system-prompt.ts', 'utf8')

assert(
  promptSource.includes("Infer the user's practical goal from the full scenario, not just the most literal wording of one sentence."),
  'System prompt must instruct the model to infer the practical goal behind a scenario'
)

assert(
  promptSource.includes('When a question involves moving, using, fixing, cleaning, charging, or bringing an object somewhere, reason about which object actually needs to end up there.'),
  'System prompt must instruct the model to reason about the relevant object in practical scenarios'
)

assert(
  promptSource.includes('the correct recommendation is to drive the car there.'),
  'System prompt must include the car-wash commonsense anchor example'
)

console.log('PASS commonsense system prompt includes practical-goal and car-wash guardrails')
