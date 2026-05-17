import type { ChatAttachment } from '@/types/models'

export function sanitizeAttachmentsForStorage(attachments?: ChatAttachment[], extractedTexts?: Map<string, string>): ChatAttachment[] | undefined {
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
    if (a.storageProvider) safe.storageProvider = a.storageProvider
    if (a.storageKey) safe.storageKey = a.storageKey
    // Persist extracted text so context survives across messages
    if (a.textContent) safe.textContent = a.textContent
    if (extractedTexts && extractedTexts.has(a.name)) {
      safe.textContent = extractedTexts.get(a.name)
    }
    // Never save dataUrl to DB — too large for JSONB/Vercel payload
    // Never save upload progress/status — ephemeral UI state
    return safe
  })

  return sanitized.length > 0 ? sanitized : undefined
}
