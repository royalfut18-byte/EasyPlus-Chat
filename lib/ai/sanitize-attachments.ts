import type { ChatAttachment } from '@/types/models'
import { sanitizeDatabaseText, sanitizeJsonForDatabase } from '@/lib/supabase/sanitize-db-text'

export function sanitizeAttachmentsForStorage(
  attachments?: ChatAttachment[],
  extractedTexts?: Map<string, string>,
  processingStatuses?: Map<string, string>
): ChatAttachment[] | undefined {
  if (!attachments || attachments.length === 0) return undefined

  const sanitized = attachments.map((a) => {
    const safe: ChatAttachment = {
      type: sanitizeDatabaseText(a.type),
      name: sanitizeDatabaseText(a.name),
      mimeType: sanitizeDatabaseText(a.mimeType),
    }
    if (a.size) safe.size = a.size
    if (a.storagePath) safe.storagePath = sanitizeDatabaseText(a.storagePath)
    if (a.bucket) safe.bucket = sanitizeDatabaseText(a.bucket)
    if (a.url) safe.url = sanitizeDatabaseText(a.url)
    if (a.storageProvider) safe.storageProvider = sanitizeDatabaseText(a.storageProvider) as ChatAttachment['storageProvider']
    if (a.storageKey) safe.storageKey = sanitizeDatabaseText(a.storageKey)
    // Persist extracted text so context survives across messages
    if (a.textContent) safe.textContent = sanitizeDatabaseText(a.textContent)
    if (extractedTexts && extractedTexts.has(a.name)) {
      safe.textContent = sanitizeDatabaseText(extractedTexts.get(a.name))
    }
    if (processingStatuses && processingStatuses.has(a.name)) {
      safe.processingStatus = sanitizeDatabaseText(processingStatuses.get(a.name))
      safe.ocrStatus = processingStatuses.get(a.name) === 'needs_ocr' ? 'needs_ocr' : safe.ocrStatus
    }
    // Never save dataUrl to DB — too large for JSONB/Vercel payload
    // Never save upload progress/status — ephemeral UI state
    return sanitizeJsonForDatabase(safe) as ChatAttachment
  })

  return sanitized.length > 0 ? sanitized : undefined
}
