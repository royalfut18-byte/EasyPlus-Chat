import 'server-only'

import sharp from 'sharp'
import type { ChatAttachment } from '@/types/models'

const SUPPORTED_INPUT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
])

const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
])

const MAX_NORMALIZED_DIMENSION = 1568
const MAX_NORMALIZED_IMAGE_BYTES = 3_500_000
const JPEG_QUALITIES = [82, 72, 62]
const WEBP_QUALITIES = [82, 72, 62]

export type NormalizedImageDiagnostics = {
  attachmentId?: string
  filename: string
  originalMimeType: string
  normalizedMimeType: string
  originalByteSize: number
  normalizedByteSize: number
  finalDataUrlLength: number
  width: number | null
  height: number | null
  orientation: number | null
  resized: boolean
}

export type NormalizedImageResult = {
  buffer: Buffer
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  dataUrl: string
  diagnostics: NormalizedImageDiagnostics
}

export function isHeicMimeType(mimeType?: string | null): boolean {
  const normalized = (mimeType || '').trim().toLowerCase()
  return HEIC_MIME_TYPES.has(normalized)
}

export function isSupportedVisionImageMimeType(mimeType?: string | null): boolean {
  const normalized = (mimeType || '').trim().toLowerCase()
  return SUPPORTED_INPUT_MIME_TYPES.has(normalized)
}

function normalizeMimeType(mimeType?: string | null): string {
  const normalized = (mimeType || '').trim().toLowerCase()
  if (normalized === 'image/jpg') return 'image/jpeg'
  return normalized
}

async function renderEncodedBuffer(
  pipeline: sharp.Sharp,
  targetMimeType: 'image/jpeg' | 'image/png' | 'image/webp',
  quality: number
): Promise<Buffer> {
  if (targetMimeType === 'image/png') {
    return pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
  }
  if (targetMimeType === 'image/webp') {
    return pipeline.webp({ quality }).toBuffer()
  }
  return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer()
}

export async function normalizeImageForVision(params: {
  buffer: Buffer
  mimeType?: string | null
  filename: string
  attachmentId?: string
}): Promise<NormalizedImageResult> {
  const normalizedInputMimeType = normalizeMimeType(params.mimeType)
  if (isHeicMimeType(normalizedInputMimeType)) {
    throw new Error('HEIC images are not supported yet. Please upload JPG or PNG.')
  }
  if (!isSupportedVisionImageMimeType(normalizedInputMimeType)) {
    throw new Error('Unsupported image type. Please upload PNG, JPG, or WEBP.')
  }

  const original = sharp(params.buffer, { failOn: 'error' })
  const metadata = await original.metadata()
  const width = typeof metadata.width === 'number' ? metadata.width : null
  const height = typeof metadata.height === 'number' ? metadata.height : null
  const orientation = typeof metadata.orientation === 'number' ? metadata.orientation : null
  const shouldResize = !!width && !!height && (width > MAX_NORMALIZED_DIMENSION || height > MAX_NORMALIZED_DIMENSION)
  const hasAlpha = !!metadata.hasAlpha

  const basePipeline = sharp(params.buffer, { failOn: 'error' }).rotate()
  if (shouldResize) {
    basePipeline.resize({
      width: MAX_NORMALIZED_DIMENSION,
      height: MAX_NORMALIZED_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  const targetMimeType: 'image/jpeg' | 'image/png' | 'image/webp' = hasAlpha
    ? 'image/png'
    : normalizedInputMimeType === 'image/webp'
      ? 'image/webp'
      : 'image/jpeg'

  const qualityCandidates = targetMimeType === 'image/webp' ? WEBP_QUALITIES : JPEG_QUALITIES
  let outputBuffer: Buffer | null = null

  if (targetMimeType === 'image/png') {
    outputBuffer = await renderEncodedBuffer(basePipeline.clone(), targetMimeType, JPEG_QUALITIES[0])
  } else {
    for (const quality of qualityCandidates) {
      const candidate = await renderEncodedBuffer(basePipeline.clone(), targetMimeType, quality)
      outputBuffer = candidate
      if (candidate.byteLength <= MAX_NORMALIZED_IMAGE_BYTES) break
    }
  }

  if (!outputBuffer) {
    throw new Error('Could not read the uploaded image. Please re-upload it.')
  }

  if (outputBuffer.byteLength > MAX_NORMALIZED_IMAGE_BYTES) {
    const fallbackBuffer = await renderEncodedBuffer(
      sharp(params.buffer, { failOn: 'error' })
        .rotate()
        .resize({
          width: 1280,
          height: 1280,
          fit: 'inside',
          withoutEnlargement: true,
        }),
      'image/jpeg',
      60
    )
    outputBuffer = fallbackBuffer
  }

  if (outputBuffer.byteLength > MAX_NORMALIZED_IMAGE_BYTES) {
    throw new Error('Image is too large for analysis. Try a smaller image.')
  }

  const finalMimeType = targetMimeType === 'image/png' && outputBuffer.byteLength > 2_500_000
    ? 'image/jpeg'
    : targetMimeType

  if (finalMimeType !== targetMimeType) {
    outputBuffer = await renderEncodedBuffer(basePipeline.clone(), 'image/jpeg', 70)
  }

  if (outputBuffer.byteLength > MAX_NORMALIZED_IMAGE_BYTES) {
    throw new Error('Image is too large for analysis. Try a smaller image.')
  }

  const dataUrl = `data:${finalMimeType};base64,${outputBuffer.toString('base64')}`

  return {
    buffer: outputBuffer,
    mimeType: finalMimeType,
    dataUrl,
    diagnostics: {
      attachmentId: params.attachmentId,
      filename: params.filename,
      originalMimeType: normalizedInputMimeType,
      normalizedMimeType: finalMimeType,
      originalByteSize: params.buffer.byteLength,
      normalizedByteSize: outputBuffer.byteLength,
      finalDataUrlLength: dataUrl.length,
      width,
      height,
      orientation,
      resized: shouldResize,
    },
  }
}
