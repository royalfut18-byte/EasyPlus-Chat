import type { SupabaseClient } from '@supabase/supabase-js'
import { createPresignedDownloadUrl, isR2Configured } from '@/lib/storage/r2'
import { AI_MODELS } from '@/types/models'

const MAX_OCR_PAGES_PER_REQUEST = 10
const MAX_RENDER_DIMENSION = 1800
const OCR_MODEL_ID = 'claude-opus-4.6'

interface RenderedPageImage {
  pageNumber: number
  base64: string
  mimeType: 'image/jpeg'
  width: number
  height: number
}

export interface OcrAttachmentPagesOptions {
  userId: string
  conversationId: string
  attachmentId: string
  pageStart: number
  pageEnd: number
}

export interface OcrAttachmentPagesResult {
  attachmentId: string
  fileName: string
  pageStart: number
  pageEnd: number
  pageCount: number
  pagesProcessed: number[]
  combinedText: string
  preview: string
}

function normalizePageRange(pageStart: number, pageEnd: number): { pageStart: number; pageEnd: number } {
  const start = Math.max(1, Math.floor(pageStart))
  const end = Math.max(start, Math.floor(pageEnd))
  return {
    pageStart: start,
    pageEnd: Math.min(end, start + MAX_OCR_PAGES_PER_REQUEST - 1),
  }
}

async function fetchR2Buffer(storageKey: string): Promise<Buffer> {
  if (!isR2Configured()) {
    throw new Error('R2 is not configured for PDF readback')
  }

  const signedUrl = await createPresignedDownloadUrl(storageKey)
  const response = await fetch(signedUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF from R2 (${response.status})`)
  }

  return Buffer.from(await response.arrayBuffer())
}

async function renderPdfPages(pdfBuffer: Buffer, pageStart: number, pageEnd: number): Promise<{
  pageCount: number
  pages: RenderedPageImage[]
}> {
  const canvas = await import('@napi-rs/canvas')
  ;(globalThis as any).DOMMatrix ||= canvas.DOMMatrix
  ;(globalThis as any).ImageData ||= canvas.ImageData
  ;(globalThis as any).Path2D ||= canvas.Path2D

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableFontFace: true,
    isEvalSupported: false,
  })
  const pdf = await loadingTask.promise
  const pageCount = pdf.numPages
  const safeEnd = Math.min(pageEnd, pageCount)
  const pages: RenderedPageImage[] = []

  for (let pageNumber = pageStart; pageNumber <= safeEnd; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(2, MAX_RENDER_DIMENSION / Math.max(baseViewport.width, baseViewport.height))
    const viewport = page.getViewport({ scale })
    const outputScale = 1
    const width = Math.ceil(viewport.width * outputScale)
    const height = Math.ceil(viewport.height * outputScale)
    const pageCanvas = canvas.createCanvas(width, height)
    const canvasContext = pageCanvas.getContext('2d')

    await page.render({
      canvasContext: canvasContext as any,
      viewport,
    }).promise

    const buffer = pageCanvas.toBuffer('image/jpeg', 82)
    pages.push({
      pageNumber,
      base64: buffer.toString('base64'),
      mimeType: 'image/jpeg',
      width,
      height,
    })
  }

  await pdf.destroy()
  return { pageCount, pages }
}

async function ocrImageWithBedrock(page: RenderedPageImage, fileName: string): Promise<string> {
  const model = AI_MODELS.find((m) => m.id === OCR_MODEL_ID)
  const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK
  const region = process.env.AWS_REGION || 'ap-southeast-2'

  if (!model?.bedrockModelId) {
    throw new Error('OCR model is not configured')
  }
  if (!apiKey) {
    throw new Error('AWS_BEARER_TOKEN_BEDROCK is not configured')
  }

  const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${model.bedrockModelId}/converse`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [
            {
              text: `OCR page ${page.pageNumber} of "${fileName}". Extract all readable text exactly in reading order. Preserve headings, question numbers, tables, and currency/number values. Return only the extracted text.`,
            },
            {
              image: {
                format: 'jpeg',
                source: {
                  bytes: page.base64,
                },
              },
            },
          ],
        },
      ],
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Bedrock OCR failed (${response.status}): ${errorText.substring(0, 200)}`)
  }

  const data = await response.json()
  return data?.output?.message?.content
    ?.map((part: { text?: string }) => part.text || '')
    .join('')
    .trim() || ''
}

export async function findLatestPdfAttachmentForOcr(
  db: SupabaseClient,
  userId: string,
  conversationId: string
): Promise<{ id: string; fileName: string } | null> {
  const { data, error } = await db
    .from('attachments')
    .select('id, file_name, mime_type, storage_path, processing_status, ocr_status')
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .eq('mime_type', 'application/pdf')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  return { id: data[0].id, fileName: data[0].file_name || 'uploaded PDF' }
}

async function savePageChunk(
  db: SupabaseClient,
  options: {
    userId: string
    conversationId: string
    attachmentId: string
    fileName: string
    pageNumber: number
    text: string
  }
) {
  if (!options.text || options.text.length < 100) return

  const { data: existing } = await db
    .from('memory_chunks')
    .select('id')
    .eq('user_id', options.userId)
    .eq('conversation_id', options.conversationId)
    .eq('source_type', 'attachment')
    .eq('source_id', options.attachmentId)
    .contains('metadata', { page_number: options.pageNumber })
    .limit(1)

  if (existing && existing.length > 0) return

  await db.from('memory_chunks').insert({
    user_id: options.userId,
    conversation_id: options.conversationId,
    source_type: 'attachment',
    source_id: options.attachmentId,
    chunk_index: options.pageNumber,
    content: options.text,
    summary: `OCR page ${options.pageNumber} from ${options.fileName}`,
    metadata: {
      attachment_id: options.attachmentId,
      file_name: options.fileName,
      page_number: options.pageNumber,
      source: 'ocr',
    },
  })
}

export async function ocrAttachmentPages(
  db: SupabaseClient,
  options: OcrAttachmentPagesOptions
): Promise<OcrAttachmentPagesResult> {
  const { pageStart, pageEnd } = normalizePageRange(options.pageStart, options.pageEnd)

  const { data: attachment, error } = await db
    .from('attachments')
    .select('id, user_id, conversation_id, file_name, mime_type, storage_path, important_details, ocr_pages_processed')
    .eq('id', options.attachmentId)
    .eq('user_id', options.userId)
    .eq('conversation_id', options.conversationId)
    .single()

  if (error || !attachment) {
    throw new Error('Attachment not found')
  }
  if (attachment.mime_type !== 'application/pdf') {
    throw new Error('OCR page rendering is only supported for PDFs')
  }

  const importantDetails = attachment.important_details || {}
  const storageKey = attachment.storage_path || importantDetails.storageKey || importantDetails.storagePath
  if (!storageKey) {
    throw new Error('This PDF does not have a stored R2 key for OCR readback')
  }

  await db
    .from('attachments')
    .update({
      processing_status: 'ocr_processing',
      ocr_status: 'processing',
      updated_at: new Date().toISOString(),
    })
    .eq('id', attachment.id)

  const existingPagesResult = await db
    .from('attachment_pages')
    .select('page_number, ocr_text, processing_status')
    .eq('attachment_id', attachment.id)
    .eq('user_id', options.userId)
    .gte('page_number', pageStart)
    .lte('page_number', pageEnd)

  const existingPages = new Map<number, string>()
  for (const page of existingPagesResult.data || []) {
    if (page.ocr_text) existingPages.set(page.page_number, page.ocr_text)
  }

  const missingPages: number[] = []
  for (let page = pageStart; page <= pageEnd; page++) {
    if (!existingPages.has(page)) missingPages.push(page)
  }

  let pageCount = attachment.important_details?.pageCount || 0
  const newTexts = new Map<number, string>()

  if (missingPages.length > 0) {
    const pdfBuffer = await fetchR2Buffer(storageKey)
    const rendered = await renderPdfPages(pdfBuffer, missingPages[0], missingPages[missingPages.length - 1])
    pageCount = rendered.pageCount

    for (const renderedPage of rendered.pages.filter((page) => missingPages.includes(page.pageNumber))) {
      const ocrText = await ocrImageWithBedrock(renderedPage, attachment.file_name || 'uploaded PDF')
      newTexts.set(renderedPage.pageNumber, ocrText)

      await db.from('attachment_pages').upsert({
        attachment_id: attachment.id,
        user_id: options.userId,
        conversation_id: options.conversationId,
        page_number: renderedPage.pageNumber,
        ocr_text: ocrText,
        vision_summary: `OCR extracted ${ocrText.length} characters from rendered page image`,
        processing_status: ocrText ? 'completed' : 'empty',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'attachment_id,page_number' })

      await savePageChunk(db, {
        userId: options.userId,
        conversationId: options.conversationId,
        attachmentId: attachment.id,
        fileName: attachment.file_name || 'uploaded PDF',
        pageNumber: renderedPage.pageNumber,
        text: ocrText,
      })
    }
  }

  const combinedPages: Array<{ pageNumber: number; text: string }> = []
  for (let page = pageStart; page <= pageEnd; page++) {
    const text = newTexts.get(page) || existingPages.get(page) || ''
    if (text) combinedPages.push({ pageNumber: page, text })
  }

  const processedPages = Array.from(new Set([
    ...(Array.isArray(attachment.ocr_pages_processed) ? attachment.ocr_pages_processed : []),
    ...combinedPages.map((page) => page.pageNumber),
  ])).sort((a, b) => a - b)

  const combinedText = combinedPages
    .map((page) => `[Page ${page.pageNumber}]\n${page.text}`)
    .join('\n\n')

  const existingOcrText = combinedText.substring(0, 12000)
  await db
    .from('attachments')
    .update({
      processing_status: combinedText ? 'ocr_ready' : 'needs_ocr',
      ocr_status: combinedText ? 'completed' : 'empty',
      page_count: pageCount || null,
      ocr_pages_processed: processedPages,
      ocr_text: existingOcrText,
      metadata: {
        ...(attachment.important_details || {}),
        pageCount: pageCount || undefined,
        lastOcrPageRange: `${pageStart}-${pageEnd}`,
      },
      important_details: {
        ...(attachment.important_details || {}),
        pageCount: pageCount || undefined,
        ocrPagesProcessed: processedPages,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', attachment.id)

  return {
    attachmentId: attachment.id,
    fileName: attachment.file_name || 'uploaded PDF',
    pageStart,
    pageEnd,
    pageCount,
    pagesProcessed: processedPages,
    combinedText,
    preview: combinedText.substring(0, 1200),
  }
}
