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
  const hasDocOrImage = attachments?.some((a) => a.type === 'document' || a.type === 'image')

  if (hasDocOrImage && hasLongKeyword) return true
  if (hasLongKeyword && lower.length > 100) return true

  const multipleActionWords = ['mark', 'refine', 'scan', 'improve', 'rewrite', 'generate', 'explain', 'solve', 'analyze', 'analyse']
  const actionCount = multipleActionWords.filter((w) => lower.includes(w)).length
  if (actionCount >= 2) return true

  return false
}

export const LONG_TASK_SYSTEM_ADDENDUM = `This is a large task.
- Complete the requested work directly instead of giving meta-advice.
- Start with the highest-value complete part of the answer.
- If the user requested a rewrite, essay, report, or structured response, keep producing the actual deliverable.
- Do not refuse because the task is long.
- Keep structure clear and finish as much of the task as possible in this response.`
