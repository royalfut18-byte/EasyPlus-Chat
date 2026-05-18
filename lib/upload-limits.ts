export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || 512)
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

export const FALLBACK_UPLOAD_MB = 50
// Keep inline base64 payloads below Vercel's function request body limits.
// Larger files should go through R2 and be fetched server-side when needed.
export const INLINE_UPLOAD_MAX_BYTES = 2.5 * 1024 * 1024

export function getMaxUploadMB(): number {
  return MAX_UPLOAD_MB
}

export function getMaxUploadBytes(): number {
  return MAX_UPLOAD_BYTES
}

export function isR2Attachment(att: any): boolean {
  return (
    att?.storageProvider === 'r2' ||
    att?.storage_provider === 'r2' ||
    !!(att?.storageKey || att?.storage_key || att?.storagePath)
  )
}

export const INLINE_ATTACHMENT_MAX_BYTES = 7 * 1024 * 1024
