import type { ChatAttachment } from '@/types/models'
import { isR2Configured, createPresignedDownloadUrl } from '@/lib/storage/r2'
import { inflateRawSync } from 'node:zlib'
import { formatZipContext, readSafeZipAttachment } from '@/lib/zip/safe-zip.server'

const DEFAULT_MAX_DOCUMENT_CHARS = 60000
const COMPREHENSIVE_MAX_DOCUMENT_CHARS = 220000
const PER_DOCUMENT_PREVIEW_CHARS = 90000

interface DocumentContextOptions {
  comprehensive?: boolean
}

export function isComprehensiveDocumentRequest(message: string): boolean {
  const lower = message.toLowerCase()
  return /\b(all|every|entire|complete|full|each|don't miss|dont miss|extract|list|go through|scan)\b/.test(lower) &&
    /\b(pdf|document|file|files|zip|project|codebase|paper|papers|question|questions|multiple choice|section|extract|syllabus|marketing)\b/.test(lower)
}

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

function extractTextFromRtfString(raw: string): string {
  return raw
    .replace(/\\par[d]?/gi, '\n')
    .replace(/\\tab/gi, '\t')
    .replace(/\\'[0-9a-f]{2}/gi, ' ')
    .replace(/\\[a-z]+-?\d* ?/gi, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function extractTextFromRtf(dataUrl: string): string {
  return extractTextFromRtfString(decodeBase64DataUrl(dataUrl))
}

async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
    const result = await pdfParse(buffer)

    if (!result.text || result.text.trim().length === 0) {
      return '__PDF_NO_TEXT__'
    }

    return result.text
  } catch (err: any) {
    console.warn('[Document Extract] pdf-parse failed, trying pdfjs:', err.message)
  }

  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    })
    const pdf = await loadingTask.promise
    const pages: string[] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const pageText = (textContent.items || [])
        .map((item: any) => typeof item?.str === 'string' ? item.str : '')
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      pages.push(`[Page ${pageNumber}]\n${pageText}`)
    }

    await pdf.destroy()
    const text = pages.join('\n\n').trim()
    return text ? text : '__PDF_NO_TEXT__'
  } catch (err: any) {
    console.error('[Document Extract] PDF extraction failed:', err.message)
    return '__PDF_EXTRACTION_FAILED__'
  }
}

async function extractTextFromPdf(dataUrl: string): Promise<string> {
  const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/)
  if (!base64Match) return '__PDF_EXTRACTION_FAILED__'
  return extractTextFromPdfBuffer(Buffer.from(base64Match[1], 'base64'))
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function xmlToText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  let eocdOffset = -1

  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }

  if (eocdOffset < 0) return entries

  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  let offset = centralDirectoryOffset

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break

    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf-8')

    if (buffer.readUInt32LE(localHeaderOffset) === 0x04034b50) {
      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize)

      if (compressionMethod === 0) {
        entries.set(fileName, compressed)
      } else if (compressionMethod === 8) {
        entries.set(fileName, inflateRawSync(compressed))
      }
    }

    offset += 46 + fileNameLength + extraLength + commentLength
  }

  return entries
}

function extractDocxText(buffer: Buffer): string {
  const entries = readZipEntries(buffer)
  const xmlParts = [...entries.entries()]
    .filter(([name]) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name))
    .map(([, data]) => data.toString('utf-8'))

  return xmlParts.map(xmlToText).filter(Boolean).join('\n\n')
}

function extractXlsxText(buffer: Buffer): string {
  const entries = readZipEntries(buffer)
  const sharedStringsXml = entries.get('xl/sharedStrings.xml')?.toString('utf-8') || ''
  const sharedStrings = [...sharedStringsXml.matchAll(/<si[\s\S]*?<\/si>/g)]
    .map(match => xmlToText(match[0]))

  const sheets = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b))

  const output: string[] = []
  for (const [name, data] of sheets) {
    const xml = data.toString('utf-8')
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(rowMatch => {
      const cells = [...rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map(cellMatch => {
        const attrs = cellMatch[1]
        const body = cellMatch[2]
        const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || ''
        if (/\bt="s"/.test(attrs)) {
          return sharedStrings[Number.parseInt(value, 10)] || ''
        }
        return decodeXmlEntities(value)
      })
      return cells.join('\t').trim()
    }).filter(Boolean)

    output.push(`[${name.replace(/^xl\/worksheets\//, '')}]\n${rows.join('\n')}`)
  }

  return output.join('\n\n')
}

function extractPptxText(buffer: Buffer): string {
  const entries = readZipEntries(buffer)
  const slides = [...entries.entries()]
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))

  return slides.map(([name, data], index) => {
    const text = [...data.toString('utf-8').matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map(match => decodeXmlEntities(match[1]))
      .join('\n')
      .trim()
    return `[Slide ${index + 1} - ${name}]\n${text}`
  }).filter(Boolean).join('\n\n')
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
  const name = attachment.name.toLowerCase()

  if (mime === 'application/zip' || name.endsWith('.zip')) {
    const zipResult = await readSafeZipAttachment(attachment)
    return formatZipContext(attachment.name, zipResult)
  }

  if (attachment.storageProvider === 'r2' && attachment.storageKey) {
    const buffer = await fetchR2FileAsBuffer(attachment.storageKey)
    if (!buffer) return '__MISSING_DATA__'

    if (mime === 'application/pdf') {
      return extractTextFromPdfBuffer(buffer)
    }
    if (mime === 'application/rtf' || mime === 'text/rtf') {
      return extractTextFromRtfString(buffer.toString('utf-8'))
    }

    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return extractDocxText(buffer)
    }
    if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      return extractXlsxText(buffer)
    }
    if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      return extractPptxText(buffer)
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
  if (mime === 'application/rtf' || mime === 'text/rtf') {
    return extractTextFromRtf(dataUrl)
  }

  const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/)
  const buffer = base64Match ? Buffer.from(base64Match[1], 'base64') : null
  if (buffer && mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocxText(buffer)
  }
  if (buffer && mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return extractXlsxText(buffer)
  }
  if (buffer && mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return extractPptxText(buffer)
  }

  return ''
}

export interface DocumentExtractionResult {
  context: string
  extractedTexts: Map<string, string>
  attachmentStatuses: Map<string, 'ready' | 'needs_ocr' | 'failed'>
  error?: string
}

export async function buildDocumentContext(
  attachments: ChatAttachment[],
  options: DocumentContextOptions = {}
): Promise<DocumentExtractionResult> {
  const docAttachments = attachments.filter((a) => a.type === 'document')
  if (docAttachments.length === 0) return { context: '', extractedTexts: new Map(), attachmentStatuses: new Map() }

  const maxDocumentChars = options.comprehensive ? COMPREHENSIVE_MAX_DOCUMENT_CHARS : DEFAULT_MAX_DOCUMENT_CHARS
  let totalChars = 0
  const blocks: string[] = []
  const extractedTexts = new Map<string, string>()
  const attachmentStatuses = new Map<string, 'ready' | 'needs_ocr' | 'failed'>()
  let extractionError: string | undefined

  for (const attachment of docAttachments) {
    console.log('[Document Extract] Processing:', {
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      hasDataUrl: !!attachment.dataUrl,
      storageProvider: attachment.storageProvider || 'inline',
      hasStorageKey: !!attachment.storageKey,
    })

    const text = await extractTextFromAttachment(attachment)

    // Detailed validation and logging
    const textLength = text?.length || 0
    const isMissingData = text === '__MISSING_DATA__'
    const isPdfFailed = text === '__PDF_EXTRACTION_FAILED__'
    const isPdfNoText = text === '__PDF_NO_TEXT__'
    const isErrorState = isMissingData || isPdfFailed || isPdfNoText
    
    if (process.env.NODE_ENV !== 'production') {
      const preview = !isErrorState && text ? text.substring(0, 1000) : '(error)'
      const hasCurrency = !isErrorState && text ? /\$\d+/.test(text) : false
      const hasDecimals = !isErrorState && text ? /\.\d{2}/.test(text) : false
      
      console.log('[Document Extract] Extraction details:', {
        name: attachment.name,
        extractedLength: textLength,
        isErrorState,
        hasCurrency,
        hasDecimals,
        preview: preview.substring(0, 300),
      })
      
      // Check for specific expected values for debugging
      if (!isErrorState && text) {
        const criticalValues = ['$140', '$25.50', '$752', '$191', '$446', '$612', 'Sally', 'electronic game machine', 'hire purchase']
        const foundValues = criticalValues.filter(val => text.includes(val))
        if (foundValues.length > 0 || process.env.DEBUG_DOCUMENT_EXTRACTION === '1') {
          console.log('[Document Extract] Critical values found:', foundValues)
        }
      }
    }

    if (text === '__MISSING_DATA__') {
      attachmentStatuses.set(attachment.name, 'failed')
      extractionError = `Document data was missing for "${attachment.name}". Please re-upload the file.`
      console.error('[Document Extract] Missing data:', attachment.name)
      continue
    }

    if (text === '__PDF_EXTRACTION_FAILED__') {
      attachmentStatuses.set(attachment.name, 'failed')
      extractionError = `PDF text extraction failed for "${attachment.name}". The file may be corrupted or unsupported.`
      console.error('[Document Extract] PDF extraction failed:', attachment.name)
      blocks.push(
        `[Attached document: ${attachment.name}]\nPDF text extraction failed. The PDF may be scanned/image-based or corrupted. Please upload a text-based PDF or convert to .txt.\n[/Attached document]`
      )
      continue
    }

    if (text === '__PDF_NO_TEXT__') {
      attachmentStatuses.set(attachment.name, 'needs_ocr')
      extractionError = `No readable text found in "${attachment.name}". This appears to be a scanned/image-only PDF and needs OCR.`
      console.error('[Document Extract] Scanned PDF needs OCR:', attachment.name)
      blocks.push(
        `[Attached document: ${attachment.name}]\nText extraction failed - scanned PDF detected. OCR needed. Ask the user for a page range, or offer to OCR the first pages/table of contents to locate the requested section. Do not say the PDF is unavailable.\n[/Attached document]`
      )
      continue
    }

    if (!text || text.trim().length === 0) {
      attachmentStatuses.set(attachment.name, 'failed')
      console.warn('[Document Extract] Empty document:', attachment.name)
      blocks.push(
        `[Attached document: ${attachment.name}]\nDocument appears to be empty or could not be read.\n[/Attached document]`
      )
      continue
    }

    attachmentStatuses.set(attachment.name, 'ready')
    extractedTexts.set(attachment.name, text)

    const remaining = maxDocumentChars - totalChars
    if (remaining <= 0) {
      console.warn('[Document Extract] Total length limit reached')
      blocks.push(
        `[Attached document: ${attachment.name}]\n[Document truncated due to total length limit]\n[/Attached document]`
      )
      break
    }

    const perDocumentLimit = options.comprehensive ? Math.min(PER_DOCUMENT_PREVIEW_CHARS, remaining) : remaining
    let finalText = text
    if (finalText.length > perDocumentLimit) {
      console.warn('[Document Extract] Individual document truncated', {
        name: attachment.name,
        original: finalText.length,
        truncated: perDocumentLimit,
      })
      finalText = finalText.substring(0, perDocumentLimit) + '\n\n[Document truncated due to length. Full text was still indexed for retrieval if storage is available.]'
    }

    totalChars += finalText.length
    blocks.push(`[Attached document: ${attachment.name}]\n${finalText}\n[/Attached document]`)

    console.log('[Document Extract] Success:', {
      name: attachment.name,
      extractedLength: finalText.length,
      totalSoFar: totalChars,
      maxAllowed: maxDocumentChars,
    })
  }

  return {
    context: blocks.join('\n\n'),
    extractedTexts,
    attachmentStatuses,
    error: extractionError,
  }
}
