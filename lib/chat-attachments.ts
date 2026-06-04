export const MAX_CHAT_ATTACHMENTS = 10
export const MAX_CHAT_IMAGE_ATTACHMENTS = 4
export const MAX_CHAT_EXTRACTED_TEXT_CHARS_PER_FILE = 40000
export const MAX_CHAT_TOTAL_EXTRACTED_TEXT_CHARS = 120000

export const CHAT_ATTACHMENT_UNSUPPORTED_ERROR =
  'Unsupported file type. Please upload an image, PDF, Word document, text file, CSV/XLSX, PowerPoint, or ZIP.'

export const CHAT_ATTACHMENT_TOO_MANY_ERROR = 'Too many files uploaded at once.'
export const CHAT_ATTACHMENT_TOO_MANY_IMAGES_ERROR = `Too many images uploaded at once. Please upload up to ${MAX_CHAT_IMAGE_ATTACHMENTS} images per message.`
export const CHAT_ATTACHMENT_READ_ERROR = 'Could not read the uploaded file. Please re-upload it.'
export const CHAT_IMAGE_UNDERSTANDING_NOT_CONFIGURED_ERROR = 'Image understanding is not configured yet.'

export const SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS = [
  '.pdf',
  '.txt',
  '.md',
  '.markdown',
  '.rtf',
  '.csv',
  '.json',
  '.docx',
  '.xlsx',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.zip',
] as const

export const SUPPORTED_CHAT_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/rtf',
  'text/rtf',
  'application/msword',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
] as const

export const SUPPORTED_CHAT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
] as const

export function normalizeChatAttachmentMimeType(mimeType?: string | null): string {
  const normalized = (mimeType || '').trim().toLowerCase()
  if (normalized === 'image/jpg') return 'image/jpeg'
  if (normalized === 'text/x-markdown') return 'text/markdown'
  if (normalized === 'application/msword') return 'application/rtf'
  return normalized
}

export function getChatAttachmentExtension(filename?: string | null): string {
  const lower = (filename || '').trim().toLowerCase()
  const dotIndex = lower.lastIndexOf('.')
  return dotIndex >= 0 ? lower.slice(dotIndex) : ''
}

export function isSupportedChatAttachment(input: {
  filename?: string | null
  mimeType?: string | null
}): boolean {
  const ext = getChatAttachmentExtension(input.filename)
  const mimeType = normalizeChatAttachmentMimeType(input.mimeType)
  return SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS.includes(ext as (typeof SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS)[number]) ||
    SUPPORTED_CHAT_ATTACHMENT_MIME_TYPES.includes(mimeType as (typeof SUPPORTED_CHAT_ATTACHMENT_MIME_TYPES)[number])
}

export function isSupportedChatImageMimeType(mimeType?: string | null): boolean {
  const normalized = normalizeChatAttachmentMimeType(mimeType)
  return SUPPORTED_CHAT_IMAGE_MIME_TYPES.includes(normalized as (typeof SUPPORTED_CHAT_IMAGE_MIME_TYPES)[number])
}
