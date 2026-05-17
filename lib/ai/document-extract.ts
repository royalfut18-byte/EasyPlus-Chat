import type { ChatAttachment } from '@/types/models'
import { isR2Configured, createPresignedDownloadUrl } from '@/lib/storage/r2'

const MAX_DOCUMENT_CHARS = 16000

function decodeBase64DataUrl(dataUrl: string): string {
  const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/)
  if (!base64Match) return ''
  const buffer = Buffer.from(base64Match[1], 'base64')
  return buffer.toString('utf-8')
}

function extractTextFromTxt(dataUrl: string): string {
  return decodeBase64DataUrl(dataUrl)
}

function extractTextFromCsv(dataUrl: string): string {
  return decodeBase64DataUrl(dataUrl)
}

function extractTextFromJson(dataUrl: string): string {
  const raw = decodeBase64DataUrl(dataUrl)
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function extractTextFromMarkdown(dataUrl: string): string {
  return decodeBase64DataUrl(dataUrl)
}

async function extractTextFromPdf(dataUrl: string): Promise<string> {
  try {
    const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/)
    if (!base64Match) return '__PDF_EXTRACTION_FAILED__'
    const buffer = Buffer.from(base64Match[1], 'base64')

    // Import pdf-parse internal lib directly to avoid test-file auto-run in index.js
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
    const result = await pdfParse(buffer)

    if (!result.text || result.text.trim().length === 0) {
      return '__PDF_NO_TEXT__'
    }

    return result.text
  } catch (err: any) {
    console.error('[Document Extract] PDF extraction failed:', err.message)
    return '__PDF_EXTRACTION_FAILED__'
  }
}

async function fetchR2FileAsBuffer(storageKey: string): Promise<Buffer | null> {
  try {
    if (!isR2Configured()) return null
    const signedUrl = await createPresignedDownloadUrl(storageKey)
    const res = await fetch(signedUrl)
    if (!res.ok) return null
    const arrayBuffer = await res.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch (err: any) {
    console.error('[Document Extract] R2 fetch failed:', err.message)
    return null
  }
}

export async function extractTextFromAttachment(attachment: ChatAttachment): Promise<string> {
  if (attachment.type !== 'document') return ''
  if (attachment.textContent) return attachment.textContent

  const mime = attachment.mimeType.toLowerCase()

  if (attachment.storageProvider === 'r2' && attachment.storageKey) {
    const buffer = await fetchR2FileAsBuffer(attachment.storageKey)
    if (!buffer) return '__MISSING_DATA__'

    if (mime === 'application/pdf') {
      try {
        const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
        const result = await pdfParse(buffer)
        if (!result.text || result.text.trim().length === 0) return '__PDF_NO_TEXT__'
        return result.text
      } catch (err: any) {
        console.error('[Document Extract] R2 PDF extraction failed:', err.message)
        return '__PDF_EXTRACTION_FAILED__'
      }
    }

    const textContent = buffer.toString('utf-8')
    if (mime === 'application/json') {
      try {
        return JSON.stringify(JSON.parse(textContent), null, 2)
      } catch {
        return textContent
      }
    }
    return textContent
  }

  const dataUrl = attachment.dataUrl
  if (!dataUrl) return '__MISSING_DATA__'

  if (mime === 'application/pdf') {
    return extractTextFromPdf(dataUrl)
  }
  if (mime === 'text/plain') {
    return extractTextFromTxt(dataUrl)
  }
  if (mime === 'text/csv') {
    return extractTextFromCsv(dataUrl)
  }
  if (mime === 'application/json') {
    return extractTextFromJson(dataUrl)
  }
  if (mime === 'text/markdown') {
    return extractTextFromMarkdown(dataUrl)
  }

  return ''
}

export interface DocumentExtractionResult {
  context: string
  error?: string
}

export async function buildDocumentContext(attachments: ChatAttachment[]): Promise<DocumentExtractionResult> {
  const docAttachments = attachments.filter((a) => a.type === 'document')
  if (docAttachments.length === 0) return { context: '' }

  let totalChars = 0
  const blocks: string[] = []
  let extractionError: string | undefined

  for (const attachment of docAttachments) {
    console.log('[Document Extract] Processing:', {
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      hasDataUrl: !!attachment.dataUrl,
    })

    const text = await extractTextFromAttachment(attachment)

    if (text === '__MISSING_DATA__') {
      extractionError = `Document data was missing for "${attachment.name}". Please re-upload the file.`
      continue
    }

    if (text === '__PDF_EXTRACTION_FAILED__') {
      extractionError = `PDF text extraction failed for "${attachment.name}". The file may be corrupted or unsupported.`
      blocks.push(
        `[Attached document: ${attachment.name}]\nPDF text extraction failed. The PDF may be scanned/image-based or corrupted. Please upload a text-based PDF or convert to .txt.\n[/Attached document]`
      )
      continue
    }

    if (text === '__PDF_NO_TEXT__') {
      extractionError = `No readable text found in "${attachment.name}". This may be a scanned/image-only PDF.`
      blocks.push(
        `[Attached document: ${attachment.name}]\nNo readable text found in this PDF. It may be a scanned/image-only document.\n[/Attached document]`
      )
      continue
    }

    if (!text || text.trim().length === 0) {
      blocks.push(
        `[Attached document: ${attachment.name}]\nDocument appears to be empty or could not be read.\n[/Attached document]`
      )
      continue
    }

    const remaining = MAX_DOCUMENT_CHARS - totalChars
    if (remaining <= 0) {
      blocks.push(
        `[Attached document: ${attachment.name}]\n[Document truncated due to total length limit]\n[/Attached document]`
      )
      break
    }

    let finalText = text
    if (finalText.length > remaining) {
      finalText = finalText.substring(0, remaining) + '\n\n[Document truncated due to length]'
    }

    totalChars += finalText.length
    blocks.push(`[Attached document: ${attachment.name}]\n${finalText}\n[/Attached document]`)

    console.log('[Document Extract] Success:', {
      name: attachment.name,
      extractedLength: finalText.length,
    })
  }

  return {
    context: blocks.join('\n\n'),
    error: extractionError,
  }
}
