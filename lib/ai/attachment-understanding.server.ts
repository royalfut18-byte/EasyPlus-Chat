import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatAttachment, ChatMessage } from '@/types/models'
import {
  buildDocumentContext,
  type DocumentExtractionResult,
} from '@/lib/ai/document-extract'
import { downloadObjectFromR2, isR2Configured } from '@/lib/storage/r2'
import {
  isHeicMimeType,
  normalizeImageForVision,
  type NormalizedImageDiagnostics,
} from '@/lib/ai/image-normalization.server'
import {
  CHAT_ATTACHMENT_READ_ERROR,
  CHAT_ATTACHMENT_TOO_MANY_ERROR,
  CHAT_ATTACHMENT_TOO_MANY_IMAGES_ERROR,
  CHAT_ATTACHMENT_UNSUPPORTED_ERROR,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_TOTAL_EXTRACTED_TEXT_CHARS,
  getChatAttachmentExtension,
  isSupportedChatAttachment,
  isSupportedChatImageMimeType,
  normalizeChatAttachmentMimeType,
} from '@/lib/chat-attachments'

type PreparedAttachmentKind =
  | 'image'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'text'
  | 'markdown'
  | 'rtf'
  | 'csv'
  | 'xlsx'
  | 'zip'
  | 'json'
  | 'unknown'

export interface PreparedAttachmentContext {
  id?: string
  kind: PreparedAttachmentKind
  name: string
  mimeType: string
  sizeBytes: number
  textContent?: string
  imageDataUrl?: string
  extractedItems?: Array<{
    name: string
    kind: string
    textContent?: string
  }>
  warning?: string
}

export interface AttachmentUnderstandingDiagnostics {
  messageHasAttachments: boolean
  messageHasImages: boolean
  attachmentCount: number
  imageCount: number
  fileTypes: string[]
  mimeTypes: string[]
  byteSizes: number[]
  extractionSucceededCount: number
  extractionFailedCount: number
  storageReadSuccessCount: number
  preparedDataUrlsCount: number
  providerSelected: string
  visionFallbackUsed: boolean
  azureGpt54Configured: boolean
  azureStatusCode: number | null
  safeReason: string | null
}

export interface PreparedCurrentMessageAttachments {
  preparedAttachments: PreparedAttachmentContext[]
  documentContext: string
  extractedTexts: Map<string, string>
  attachmentStatuses: Map<string, 'ready' | 'needs_ocr' | 'failed'>
  diagnostics: AttachmentUnderstandingDiagnostics
}

export interface HistoricalAttachmentFollowUpResult {
  attachments: ChatAttachment[]
  userMessageAugmented: boolean
  source: 'image' | 'file' | 'none'
}

export type PreparedImageAttachment = {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  dataUrl: string
  originalMimeType: string
  originalSizeBytes: number
  normalizedSizeBytes: number
  dataUrlLength: number
  resized: boolean
  orientation: number | null
}

const MAX_MODEL_IMAGE_BYTES = 5 * 1024 * 1024

type AttachmentRow = {
  id: string
  conversation_id: string
  file_name: string | null
  mime_type: string | null
  storage_path: string | null
  important_details?: Record<string, any> | null
}

function getAttachmentStorageKey(attachment: Partial<ChatAttachment> & Record<string, any>): string | null {
  return attachment.storageKey ||
    attachment.storage_key ||
    attachment.storagePath ||
    attachment.storage_path ||
    null
}

function buildImagePreparationError(message: string): Error {
  return new Error(message)
}

function looksLikeImageReference(message: string): boolean {
  return /\b(the image|the screenshot|the photo|the picture|the attached file|look at the image i sent|look at the screenshot i sent|analyze this|compare these|what does this say|translate the text in it|what should i press|fix this error|what is in this image)\b/i.test(message)
}

function looksLikeImagePronounFollowUp(message: string): boolean {
  return /\b(it|this|that)\b/i.test(message) &&
    /\b(say|says|show|shows|mean|means|press|click|button|error|read|translate|analy[sz]e|look|fix|compare|what)\b/i.test(message)
}

function getRecentImageAttachmentsFromMessages(currentMessages: ChatMessage[]): ChatAttachment[] {
  const priorMessages = currentMessages.slice(0, -1).filter((message) => message.role === 'user')
  const attachments = priorMessages
    .flatMap((message) => message.attachments || [])
    .filter((attachment) => attachment.type === 'image')
    .reverse()

  const deduped: ChatAttachment[] = []
  const seen = new Set<string>()
  for (const attachment of attachments) {
    const key = attachment.attachmentId || getAttachmentStorageKey(attachment) || `${attachment.name}|${attachment.mimeType}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(attachment)
    if (deduped.length >= MAX_CHAT_IMAGE_ATTACHMENTS) break
  }

  return deduped
}

async function findAttachmentRowForImage(params: {
  db: SupabaseClient
  userId: string
  conversationId?: string | null
  attachment: ChatAttachment
}): Promise<AttachmentRow | null> {
  const { db, userId, conversationId, attachment } = params
  const attachmentId = attachment.attachmentId

  if (attachmentId) {
    let query = db
      .from('attachments')
      .select('id, conversation_id, file_name, mime_type, storage_path, important_details')
      .eq('id', attachmentId)
      .eq('user_id', userId)
      .limit(1)

    if (conversationId) {
      query = query.eq('conversation_id', conversationId)
    }

    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return (data as AttachmentRow | null) || null
  }

  const storageKey = getAttachmentStorageKey(attachment)
  if (!storageKey || !conversationId) return null

  const { data, error } = await db
    .from('attachments')
    .select('id, conversation_id, file_name, mime_type, storage_path, important_details')
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .eq('storage_path', storageKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as AttachmentRow | null) || null
}

export async function prepareImageAttachmentsForModel(params: {
  attachments?: ChatAttachment[]
  userId: string
  conversationId?: string | null
  db?: SupabaseClient
}): Promise<PreparedImageAttachment[]> {
  const { attachments = [], userId, conversationId = null, db } = params
  const imageAttachments = attachments.filter((attachment) => attachment.type === 'image')

  if (imageAttachments.length === 0) return []

  if (!isR2Configured()) {
    throw buildImagePreparationError('Could not read the uploaded image. Please re-upload it.')
  }

  return Promise.all(imageAttachments.map(async (attachment, index) => {
    const attachmentRow = db
      ? await findAttachmentRowForImage({ db, userId, conversationId, attachment })
      : null

    if (attachment.attachmentId && !attachmentRow) {
      throw buildImagePreparationError('Could not find the uploaded image. Please re-upload it.')
    }

    const mimeType = normalizeChatAttachmentMimeType(attachmentRow?.mime_type || attachment.mimeType)
    if (isHeicMimeType(mimeType)) {
      throw buildImagePreparationError('HEIC images are not supported yet. Please upload JPG or PNG.')
    }
    if (!isSupportedChatImageMimeType(mimeType)) {
      throw buildImagePreparationError('Unsupported image type. Please upload PNG, JPG, or WEBP.')
    }

    const storageKey = getAttachmentStorageKey(attachmentRow?.important_details || {}) ||
      attachmentRow?.storage_path ||
      getAttachmentStorageKey(attachment)

    if (!storageKey) {
      throw buildImagePreparationError('Image upload was not attached to the message. Please upload it again.')
    }

    if (!storageKey.startsWith(`uploads/${userId}/`)) {
      throw buildImagePreparationError('Could not read the uploaded image. Please re-upload it.')
    }

    let buffer: Buffer
    try {
      buffer = await downloadObjectFromR2(storageKey)
    } catch {
      throw buildImagePreparationError('Could not read the uploaded image. Please re-upload it.')
    }

    const originalByteSize = buffer.byteLength
    const originalMimeType = mimeType
    if (originalByteSize > MAX_MODEL_IMAGE_BYTES * 6) {
      throw buildImagePreparationError('Image is too large. Please upload a smaller image.')
    }

    let normalized
    try {
      normalized = await normalizeImageForVision({
        buffer,
        mimeType,
        filename: attachmentRow?.file_name || attachment.name || `image-${index + 1}`,
        attachmentId: attachmentRow?.id || attachment.attachmentId,
      })
    } catch (error: any) {
      throw buildImagePreparationError(error?.message || 'Could not read the uploaded image. Please re-upload it.')
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Image Prep] Normalized image for vision', {
        attachmentId: normalized.diagnostics.attachmentId || attachment.attachmentId || null,
        filename: normalized.diagnostics.filename,
        originalMimeType: normalized.diagnostics.originalMimeType,
        normalizedMimeType: normalized.diagnostics.normalizedMimeType,
        originalByteSize: normalized.diagnostics.originalByteSize,
        normalizedByteSize: normalized.diagnostics.normalizedByteSize,
        width: normalized.diagnostics.width,
        height: normalized.diagnostics.height,
        orientation: normalized.diagnostics.orientation,
        resized: normalized.diagnostics.resized,
        dataUrlLength: normalized.diagnostics.finalDataUrlLength,
      })
    }

    return {
      id: attachmentRow?.id || attachment.attachmentId || storageKey || `image-${index}`,
      filename: attachmentRow?.file_name || attachment.name || `image-${index + 1}`,
      mimeType: normalized.mimeType,
      sizeBytes: normalized.diagnostics.normalizedByteSize,
      dataUrl: normalized.dataUrl,
      originalMimeType,
      originalSizeBytes: originalByteSize,
      normalizedSizeBytes: normalized.diagnostics.normalizedByteSize,
      dataUrlLength: normalized.diagnostics.finalDataUrlLength,
      resized: normalized.diagnostics.resized,
      orientation: normalized.diagnostics.orientation,
    }
  }))
}

function detectPreparedAttachmentKind(attachment: ChatAttachment): PreparedAttachmentKind {
  const mimeType = normalizeChatAttachmentMimeType(attachment.mimeType)
  const ext = getChatAttachmentExtension(attachment.name)

  if (attachment.type === 'image') return 'image'
  if (mimeType === 'application/pdf' || ext === '.pdf') return 'pdf'
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') return 'docx'
  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || ext === '.pptx') return 'pptx'
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === '.xlsx') return 'xlsx'
  if (mimeType === 'application/zip' || ext === '.zip') return 'zip'
  if (mimeType === 'text/csv' || ext === '.csv') return 'csv'
  if (mimeType === 'text/markdown' || ext === '.md' || ext === '.markdown') return 'markdown'
  if (mimeType === 'application/rtf' || mimeType === 'text/rtf' || ext === '.rtf') return 'rtf'
  if (mimeType === 'application/json' || ext === '.json') return 'json'
  if (mimeType === 'text/plain' || ext === '.txt') return 'text'
  return 'unknown'
}

function trimPreparedDocumentText(text: string): string {
  if (text.length <= MAX_CHAT_TOTAL_EXTRACTED_TEXT_CHARS) return text
  return `${text.slice(0, MAX_CHAT_TOTAL_EXTRACTED_TEXT_CHARS)}\n\n[Document truncated due to attachment context limit.]`
}

function looksLikeImageFollowUp(message: string): boolean {
  return looksLikeImageReference(message) ||
    (
      /\b(image|photo|picture|screenshot|diagram|graph|chart|ui shot|screen shot)\b/i.test(message) &&
      /\b(sent|uploaded|shared|attached|earlier|before|previous|last|that|this)\b/i.test(message)
    )
}

function looksLikeFileFollowUp(message: string): boolean {
  return /\b(file|document|pdf|docx|word|pptx|powerpoint|csv|xlsx|spreadsheet|zip|attachment)\b/i.test(message) &&
    /\b(sent|uploaded|shared|attached|earlier|before|previous|last|that|this|summari[sz]e|look at|compare)\b/i.test(message)
}

function normalizeHistoricalAttachmentRow(row: any): ChatAttachment | null {
  const importantDetails = row?.important_details || {}
  const storageKey = row?.storage_path || importantDetails.storageKey || importantDetails.storagePath || null
  const fileType = row?.file_type === 'image' ? 'image' : 'document'
  const attachment: ChatAttachment = {
    type: fileType,
    name: row?.file_name || 'attachment',
    mimeType: row?.mime_type || 'application/octet-stream',
    size: typeof row?.size_bytes === 'number' ? row.size_bytes : undefined,
    textContent: row?.extracted_text || undefined,
    storageProvider: storageKey ? 'r2' : undefined,
    storageKey: storageKey || undefined,
    storagePath: storageKey || undefined,
    bucket: importantDetails.bucket || undefined,
    attachmentId: row?.id || undefined,
    processingStatus: row?.processing_status || undefined,
    ocrStatus: row?.ocr_status || undefined,
    pageCount: row?.page_count || undefined,
  }

  if (attachment.type === 'image' && !attachment.storageKey && !attachment.dataUrl) {
    return null
  }

  return attachment
}

export async function reconstructHistoricalAttachmentsForFollowUp(params: {
  db: SupabaseClient
  userId: string
  conversationId: string
  latestMessage: string
  currentMessages: ChatMessage[]
}): Promise<HistoricalAttachmentFollowUpResult> {
  const { db, userId, conversationId, latestMessage, currentMessages } = params
  const latestCurrentMessage = currentMessages[currentMessages.length - 1]
  if (latestCurrentMessage?.attachments?.length) {
    return { attachments: [], userMessageAugmented: false, source: 'none' }
  }

  const wantsImage = looksLikeImageFollowUp(latestMessage)
    || (looksLikeImagePronounFollowUp(latestMessage) && getRecentImageAttachmentsFromMessages(currentMessages).length > 0)
  const wantsFile = !wantsImage && looksLikeFileFollowUp(latestMessage)
  if (!wantsImage && !wantsFile) {
    return { attachments: [], userMessageAugmented: false, source: 'none' }
  }

  if (wantsImage) {
    const recentMessageImages = getRecentImageAttachmentsFromMessages(currentMessages)
    if (recentMessageImages.length > 0) {
      return {
        attachments: recentMessageImages,
        userMessageAugmented: true,
        source: 'image',
      }
    }
  }

  const { data: rows, error } = await db
    .from('attachments')
    .select('id, file_name, file_type, mime_type, storage_path, extracted_text, important_details, processing_status, ocr_status, page_count, created_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(wantsImage ? 4 : 6)

  if (error || !rows?.length) {
    return { attachments: [], userMessageAugmented: false, source: wantsImage ? 'image' : 'file' }
  }

  const filteredRows = (rows as any[]).filter((row) => wantsImage ? row.file_type === 'image' : row.file_type !== 'image')
  const attachments = filteredRows
    .map(normalizeHistoricalAttachmentRow)
    .filter((attachment): attachment is ChatAttachment => Boolean(attachment))

  return {
    attachments,
    userMessageAugmented: attachments.length > 0 && wantsImage,
    source: wantsImage ? 'image' : 'file',
  }
}

function buildPreparedAttachments(
  attachments: ChatAttachment[],
  extractionResult: DocumentExtractionResult,
  hydratedCurrentMessage?: ChatMessage
): PreparedAttachmentContext[] {
  const hydratedByName = new Map(
    (hydratedCurrentMessage?.attachments || []).map((attachment) => [attachment.name, attachment] as const)
  )

  return attachments.map((attachment) => {
    const kind = detectPreparedAttachmentKind(attachment)
    const hydrated = hydratedByName.get(attachment.name)
    const status = extractionResult.attachmentStatuses.get(attachment.name)
    const extractedText = extractionResult.extractedTexts.get(attachment.name)

    let warning: string | undefined
    if (status === 'needs_ocr') {
      warning = 'This PDF appears to be scanned or image-based, so text extraction is limited.'
    } else if (status === 'failed') {
      warning = CHAT_ATTACHMENT_READ_ERROR
    }

    return {
      id: attachment.attachmentId,
      kind,
      name: attachment.name,
      mimeType: normalizeChatAttachmentMimeType(attachment.mimeType),
      sizeBytes: attachment.size || 0,
      textContent: extractedText,
      imageDataUrl: hydrated?.type === 'image' ? hydrated.dataUrl : undefined,
      warning,
    }
  })
}

export function validateCurrentMessageAttachments(attachments?: ChatAttachment[]): void {
  if (!attachments || attachments.length === 0) return

  if (attachments.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(CHAT_ATTACHMENT_TOO_MANY_ERROR)
  }

  const imageCount = attachments.filter((attachment) => attachment.type === 'image').length
  if (imageCount > MAX_CHAT_IMAGE_ATTACHMENTS) {
    throw new Error(CHAT_ATTACHMENT_TOO_MANY_IMAGES_ERROR)
  }

  for (const attachment of attachments) {
    if (!isSupportedChatAttachment({ filename: attachment.name, mimeType: attachment.mimeType })) {
      throw new Error(CHAT_ATTACHMENT_UNSUPPORTED_ERROR)
    }

    if (attachment.type === 'image' && !isSupportedChatImageMimeType(attachment.mimeType)) {
      throw new Error(CHAT_ATTACHMENT_UNSUPPORTED_ERROR)
    }
  }
}

export async function prepareCurrentMessageAttachmentsForModel(params: {
  attachments?: ChatAttachment[]
  comprehensive?: boolean
  hydratedCurrentMessage?: ChatMessage
  extractionResult?: DocumentExtractionResult
  providerSelected: string
  visionFallbackUsed?: boolean
  azureGpt54Configured?: boolean
  azureStatusCode?: number | null
  safeReason?: string | null
}): Promise<PreparedCurrentMessageAttachments> {
  const {
    attachments = [],
    comprehensive = false,
    hydratedCurrentMessage,
    extractionResult: providedExtractionResult,
    providerSelected,
    visionFallbackUsed = false,
    azureGpt54Configured = false,
    azureStatusCode = null,
    safeReason = null,
  } = params

  validateCurrentMessageAttachments(attachments)

  const documentAttachments = attachments.filter((attachment) => attachment.type === 'document')
  const extractionResult = providedExtractionResult || (documentAttachments.length > 0
    ? await buildDocumentContext(documentAttachments, { comprehensive })
    : { context: '', extractedTexts: new Map(), attachmentStatuses: new Map() })

  const preparedAttachments = buildPreparedAttachments(attachments, extractionResult, hydratedCurrentMessage)
  const extractionSucceededCount = Array.from(extractionResult.attachmentStatuses.values())
    .filter((status) => status === 'ready').length
  const extractionFailedCount = Array.from(extractionResult.attachmentStatuses.values())
    .filter((status) => status !== 'ready').length

  return {
    preparedAttachments,
    documentContext: trimPreparedDocumentText(extractionResult.context || ''),
    extractedTexts: extractionResult.extractedTexts,
    attachmentStatuses: extractionResult.attachmentStatuses,
    diagnostics: {
      messageHasAttachments: attachments.length > 0,
      messageHasImages: attachments.some((attachment) => attachment.type === 'image'),
      attachmentCount: attachments.length,
      imageCount: attachments.filter((attachment) => attachment.type === 'image').length,
      fileTypes: preparedAttachments.map((attachment) => attachment.kind),
      mimeTypes: preparedAttachments.map((attachment) => attachment.mimeType),
      byteSizes: preparedAttachments.map((attachment) => attachment.sizeBytes),
      extractionSucceededCount,
      extractionFailedCount,
      storageReadSuccessCount: hydratedCurrentMessage?.attachments?.filter((attachment) => attachment.type === 'image' && !!attachment.dataUrl).length || 0,
      preparedDataUrlsCount: preparedAttachments.filter((attachment) => attachment.kind === 'image' && !!attachment.imageDataUrl).length,
      providerSelected,
      visionFallbackUsed,
      azureGpt54Configured,
      azureStatusCode,
      safeReason,
    },
  }
}

export async function prepareMessagesForAttachmentModel(
  params: {
    messages: ChatMessage[]
    userId: string
    conversationId?: string | null
    db?: SupabaseClient
  }
): Promise<ChatMessage[]> {
  const { messages, userId, conversationId = null, db } = params
  const preparedByMessageIndex = new Map<number, PreparedImageAttachment[]>()

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.role !== 'user' || !message.attachments?.some((attachment) => attachment.type === 'image')) continue

    try {
      const preparedImages = await prepareImageAttachmentsForModel({
        attachments: message.attachments,
        userId,
        conversationId,
        db,
      })
      preparedByMessageIndex.set(index, preparedImages)
    } catch (error: any) {
      const isCurrentUserMessage = index === messages.length - 1
      if (isCurrentUserMessage) throw error
      console.warn('[Image Prep] Skipping historical image attachments:', error?.message || 'unknown error')
      preparedByMessageIndex.set(index, [])
    }
  }

  return messages.map((message, index) => {
    if (!message.attachments || message.attachments.length === 0) return message

    const preparedForMessage = preparedByMessageIndex.get(index) || []
    const preparedByKey = new Map(
      preparedForMessage.map((attachment) => [attachment.id, attachment] as const)
    )
    const modelAttachments = message.attachments
      .filter((attachment) => attachment.type === 'image')
      .map((attachment) => {
        const key = attachment.attachmentId || getAttachmentStorageKey(attachment) || attachment.name
        const prepared = preparedByKey.get(key)
        if (!prepared) return attachment
        return {
          ...attachment,
          mimeType: prepared.mimeType,
          size: prepared.sizeBytes,
          dataUrl: prepared.dataUrl,
        }
      })
      .filter((attachment) => !!attachment.dataUrl)

    return {
      ...message,
      attachments: modelAttachments.length > 0 ? modelAttachments : undefined,
    }
  })
}
