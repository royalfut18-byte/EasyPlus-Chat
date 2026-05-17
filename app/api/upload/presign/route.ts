import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isR2Configured, createPresignedUploadUrl } from '@/lib/storage/r2'

export const runtime = 'nodejs'

const MAX_UPLOAD_BYTES = (parseInt(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || '512', 10)) * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-tar',
  'application/gzip',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
])

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 200)
}

export async function POST(request: NextRequest) {
  try {
    if (!isR2Configured()) {
      const missing = [
        !process.env.R2_ACCOUNT_ID && 'R2_ACCOUNT_ID',
        !(process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY) && 'R2_ACCESS_KEY_ID',
        !process.env.R2_SECRET_ACCESS_KEY && 'R2_SECRET_ACCESS_KEY',
      ].filter(Boolean)
      console.error('[Upload Presign] R2 not configured. Missing:', missing.join(', '))
      return NextResponse.json(
        { error: `Cloud storage not configured. Missing: ${missing.join(', ')}` },
        { status: 503 }
      )
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { fileName, mimeType, sizeBytes, conversationId } = body

    if (!fileName || !mimeType || !sizeBytes) {
      return NextResponse.json(
        { error: 'Missing required fields: fileName, mimeType, sizeBytes' },
        { status: 400 }
      )
    }

    if (typeof sizeBytes !== 'number' || sizeBytes <= 0) {
      return NextResponse.json(
        { error: 'Invalid file size' },
        { status: 400 }
      )
    }

    if (sizeBytes > MAX_UPLOAD_BYTES) {
      const maxMB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))
      return NextResponse.json(
        { error: `File too large. Maximum upload size is ${maxMB}MB.` },
        { status: 413 }
      )
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: `File type not allowed: ${mimeType}` },
        { status: 400 }
      )
    }

    const safeFileName = sanitizeFileName(fileName)
    const timestamp = Date.now()
    const folder = conversationId || 'temp'
    const key = `uploads/${user.id}/${folder}/${timestamp}-${safeFileName}`

    console.log('[Upload Presign] Generating URL:', {
      fileName: safeFileName,
      mimeType,
      sizeBytes,
      key,
      bucket: process.env.R2_BUCKET_NAME || 'easyplus-uploads',
      hasAccountId: !!process.env.R2_ACCOUNT_ID,
      hasAccessKeyId: !!(process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY),
      hasSecret: !!process.env.R2_SECRET_ACCESS_KEY,
    })

    const result = await createPresignedUploadUrl({
      key,
      mimeType,
      sizeBytes,
    })

    return NextResponse.json({
      uploadUrl: result.uploadUrl,
      key: result.key,
      bucket: result.bucket,
      storageProvider: 'r2',
      expiresIn: result.expiresIn,
    })
  } catch (err: any) {
    console.error('[Upload Presign] Error:', err.message, err.stack)
    return NextResponse.json(
      { error: `Failed to generate upload URL: ${err.message}` },
      { status: 500 }
    )
  }
}
