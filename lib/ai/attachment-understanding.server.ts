import 'server-only'

import type { ChatAttachment, ChatMessage } from '@/types/models'
import {
  buildDocumentContext,
  type DocumentExtractionResult,
} from '@/lib/ai/document-extract'
import { hydrateImageAttachmentsForModel } from '@/lib/ai/image-attachments'
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
  kind: PreparedAttachmentKind
  name: string
  mimeType: string
  sizeBytes: number
  textContent?: string
  imageDataUrl?: string
  warning?: string
}

export interface AttachmentUnderstandingDiagnostics {
  messageHasAttachments: boolean
  messageHasImages: boolean
  attachmentCount: number
  imageCount: number
  fileTypes: string[]
  extractionSucceededCount: number
  extractionFailedCount: number
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
      extractionSucceededCount,
      extractionFailedCount,
      providerSelected,
      visionFallbackUsed,
      azureGpt54Configured,
      azureStatusCode,
      safeReason,
    },
  }
}

export async function prepareMessagesForAttachmentModel(
  messages: ChatMessage[],
  userId: string
): Promise<ChatMessage[]> {
  const hydratedMessages = await hydrateImageAttachmentsForModel(messages, userId)
  return hydratedMessages.map((message) => {
    if (!message.attachments || message.attachments.length === 0) return message

    const modelAttachments = message.attachments.filter((attachment) => attachment.type === 'image')
    return {
      ...message,
      attachments: modelAttachments.length > 0 ? modelAttachments : undefined,
    }
  })
}
