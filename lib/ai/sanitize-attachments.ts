import type { ChatAttachment } from '@/types/models'

export function sanitizeAttachmentsForStorage(attachments?: ChatAttachment[]): ChatAttachment[] | undefined {
  if (!attachments || attachments.length === 0) return undefined

  const sanitized = attachments.map((a) => {
    const safe: ChatAttachment = {
      type: a.type,
      name: a.name,
      mimeType: a.mimeType,
    }
    if (a.size) safe.size = a.size
    if (a.storagePath) safe.storagePath = a.storagePath
    if (a.bucket) safe.bucket = a.bucket
    if (a.url) safe.url = a.url
    // Never save dataUrl to DB — too large for JSONB/Vercel payload
    return safe
  })

  return sanitized.length > 0 ? sanitized : undefined
}
