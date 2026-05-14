import type { ChatAttachment } from '@/types/models'

const LONG_TASK_KEYWORDS = [
  'scan',
  'analyse',
  'analyze',
  'mark',
  'refine',
  '20/20',
  'band 6',
  'skeletal essay',
  'full essay',
  'detailed',
  'step by step',
  'explain fully',
  'solve all',
  'generate full',
  'long response',
  'comprehensive',
  'in detail',
  'complete analysis',
  'full breakdown',
  'write me a full',
  'mark out of',
]

export function isLongTaskRequest(message: string, attachments?: ChatAttachment[]): boolean {
  const lower = message.toLowerCase()

  const hasLongKeyword = LONG_TASK_KEYWORDS.some((kw) => lower.includes(kw))

  const hasAttachments = attachments && attachments.length > 0
  const hasDocOrImage = attachments?.some((a) => a.type === 'document' || a.type === 'image')

  if (hasDocOrImage && hasLongKeyword) return true

  if (hasLongKeyword && lower.length > 100) return true

  const multipleActionWords = ['mark', 'refine', 'scan', 'improve', 'rewrite', 'generate', 'explain', 'solve', 'analyze', 'analyse']
  const actionCount = multipleActionWords.filter((w) => lower.includes(w)).length
  if (actionCount >= 2) return true

  return false
}

export const LONG_TASK_SYSTEM_ADDENDUM = `This is a large task. You MUST answer it — do NOT refuse or say it is too long. Answer in a structured way. Start with the most useful complete section first.

Strategy for large requests:
- If the user asks for multiple things (e.g. structure + skeleton + full essay), deliver them in logical parts within your response.
- Start with: thesis, essay structure, introduction, body paragraph plan, and adaptable skeleton.
- Then write the full essay content.
- If you genuinely cannot fit everything in one response, end with: "Say **continue** for the next part."
- NEVER say "This task took too long" or refuse to attempt the task.
- NEVER tell the user to ask for one part at a time — just answer as much as you can and offer to continue.

You have plenty of space. Use it. Prioritise completeness and quality.`
