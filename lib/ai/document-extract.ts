import type { ChatAttachment } from '@/types/models'

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
    if (!base64Match) return ''
    const buffer = Buffer.from(base64Match[1], 'base64')
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    const result = await parser.getText()
    await parser.destroy()
    return result.text || ''
  } catch (err: any) {
    console.error('[Document Extract] PDF extraction failed:', err.message)
    return '__PDF_EXTRACTION_FAILED__'
  }
}

export async function extractTextFromAttachment(attachment: ChatAttachment): Promise<string> {
  if (attachment.type !== 'document') return ''
  if (attachment.textContent) return attachment.textContent

  const dataUrl = attachment.dataUrl
  if (!dataUrl) return ''

  const mime = attachment.mimeType.toLowerCase()

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

export async function buildDocumentContext(attachments: ChatAttachment[]): Promise<string> {
  const docAttachments = attachments.filter((a) => a.type === 'document')
  if (docAttachments.length === 0) return ''

  let totalChars = 0
  const blocks: string[] = []

  for (const attachment of docAttachments) {
    let text = await extractTextFromAttachment(attachment)

    if (text === '__PDF_EXTRACTION_FAILED__') {
      blocks.push(
        `[Attached document: ${attachment.name}]\nPDF text extraction failed. The PDF may be scanned/image-based or corrupted. Please upload a text-based PDF or convert to .txt.\n[/Attached document]`
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

    if (text.length > remaining) {
      text = text.substring(0, remaining) + '\n\n[Document truncated due to length]'
    }

    totalChars += text.length
    blocks.push(`[Attached document: ${attachment.name}]\n${text}\n[/Attached document]`)
  }

  return blocks.join('\n\n')
}
