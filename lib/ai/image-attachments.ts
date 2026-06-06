import type { ChatAttachment, ChatMessage } from '@/types/models'
import { downloadObjectFromR2, isR2Configured } from '@/lib/storage/r2'

const MODEL_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
const MAX_MODEL_IMAGE_BYTES = 5 * 1024 * 1024

function normalizeImageMimeType(mimeType?: string): string {
  const normalized = (mimeType || '').toLowerCase()
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized
}

function getStorageKey(attachment: any): string | undefined {
  return attachment.storageKey || attachment.storage_key || attachment.storagePath || attachment.storage_path
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

async function hydrateImageAttachment(
  attachment: ChatAttachment,
  userId: string,
  isCurrentMessage: boolean
): Promise<ChatAttachment> {
  if (attachment.type !== 'image' || attachment.dataUrl) {
    return attachment
  }

  const mimeType = normalizeImageMimeType(attachment.mimeType)
  if (!MODEL_IMAGE_MIME_TYPES.has(mimeType)) {
    if (!isCurrentMessage) return attachment
    throw new Error('Unsupported image type. Please upload PNG, JPG, or WEBP.')
  }

  const storageKey = getStorageKey(attachment)
  if (!storageKey) {
    // Historical messages may lack storage keys — skip silently
    if (!isCurrentMessage) return attachment
    throw new Error('Image upload was not attached to the message. Please upload it again.')
  }

  if (!storageKey.startsWith(`uploads/${userId}/`)) {
    throw new Error(`Access denied for image "${attachment.name}".`)
  }

  if (!isR2Configured()) {
    throw new Error('Could not read the uploaded image. Please re-upload it.')
  }

  const buffer = await downloadObjectFromR2(storageKey)
  if (buffer.byteLength > MAX_MODEL_IMAGE_BYTES) {
    throw new Error('Image is too large. Please upload a smaller image.')
  }

  const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`

  return {
    ...attachment,
    mimeType,
    dataUrl,
  }
}

export async function hydrateImageAttachmentsForModel(
  messages: ChatMessage[],
  userId: string
): Promise<ChatMessage[]> {
  const lastIndex = messages.length - 1
  return Promise.all(
    messages.map(async (message, idx) => {
      if (!message.attachments || message.attachments.length === 0) {
        return message
      }

      const isCurrentMessage = idx === lastIndex && message.role === 'user'
      const attachments = await Promise.all(
        message.attachments.map(async (attachment) => {
          try {
            return await hydrateImageAttachment(attachment, userId, isCurrentMessage)
          } catch (err: any) {
            if (isCurrentMessage) throw err
            // Non-critical: historical image failed to load, skip it
            console.warn('[Image Hydration] Skipping historical image:', attachment.name, err.message)
            return attachment
          }
        })
      )

      return {
        ...message,
        attachments,
      }
    })
  )
}
