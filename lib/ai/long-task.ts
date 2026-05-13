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

export const LONG_TASK_SYSTEM_ADDENDUM = `This is a long task. Provide a complete but efficient response. Prioritize the most useful answer first. Avoid unnecessary repetition. If the answer would be extremely long, give the best complete version within the response limit and offer to continue.`
