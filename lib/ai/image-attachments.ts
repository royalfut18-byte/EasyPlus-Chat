import type { ChatAttachment, ChatMessage } from '@/types/models'
import { createPresignedDownloadUrl, isR2Configured } from '@/lib/storage/r2'

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
  userId: string
): Promise<ChatAttachment> {
  if (attachment.type !== 'image' || attachment.dataUrl) {
    return attachment
  }

  const mimeType = normalizeImageMimeType(attachment.mimeType)
  if (!MODEL_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported image type for "${attachment.name}". Please upload PNG, JPEG, or WebP.`)
  }

  const storageKey = getStorageKey(attachment)
  if (!storageKey) {
    throw new Error(`Image "${attachment.name}" did not finish uploading. Remove it and upload it again.`)
  }

  if (!storageKey.startsWith(`uploads/${userId}/`)) {
    throw new Error(`Access denied for image "${attachment.name}".`)
  }

  if (!isR2Configured()) {
    throw new Error('Cloud image storage is not configured.')
  }

  const signedUrl = await createPresignedDownloadUrl(storageKey)
  const response = await fetch(signedUrl, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`Could not load uploaded image "${attachment.name}" from cloud storage.`)
  }

  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_MODEL_IMAGE_BYTES) {
    throw new Error(
      `Image "${attachment.name}" is ${formatMB(arrayBuffer.byteLength)}MB after compression. Please upload a smaller image.`
    )
  }

  const dataUrl = `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString('base64')}`

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
  return Promise.all(
    messages.map(async (message) => {
      if (!message.attachments || message.attachments.length === 0) {
        return message
      }

      const attachments = await Promise.all(
        message.attachments.map((attachment) => hydrateImageAttachment(attachment, userId))
      )

      return {
        ...message,
        attachments,
      }
    })
  )
}
