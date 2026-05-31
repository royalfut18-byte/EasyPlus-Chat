import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'

export const runtime = 'nodejs'

const SERVER_UPLOAD_MAX_BYTES = 20 * 1024 * 1024 // 20MB limit for server uploads

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
    // Verify authentication
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const entitlementBlock = getEntitlementBlockResponse(await getAccountEntitlement(supabase as any, user.id))
    if (entitlementBlock) return entitlementBlock

    // Check R2 configuration
    const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
    const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY
    const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
    const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'easyplus-uploads'

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      const missing = [
        !R2_ACCOUNT_ID && 'R2_ACCOUNT_ID',
        !R2_ACCESS_KEY_ID && 'R2_ACCESS_KEY_ID',
        !R2_SECRET_ACCESS_KEY && 'R2_SECRET_ACCESS_KEY',
      ].filter(Boolean)
      return NextResponse.json(
        { error: `R2 not configured. Missing: ${missing.join(', ')}` },
        { status: 503 }
      )
    }

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const conversationId = (formData.get('conversationId') as string) || null

    if (!file) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }

    // Validate file
    if (file.size <= 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 })
    }

    if (file.size > SERVER_UPLOAD_MAX_BYTES) {
      const maxMB = Math.round(SERVER_UPLOAD_MAX_BYTES / (1024 * 1024))
      return NextResponse.json(
        { error: `File too large for server upload. Maximum is ${maxMB}MB.` },
        { status: 413 }
      )
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `File type not allowed: ${file.type}` },
        { status: 400 }
      )
    }

    // Prepare upload
    const safeFileName = sanitizeFileName(file.name)
    const timestamp = Date.now()
    const folder = conversationId || 'temp'
    const key = `uploads/${user.id}/${folder}/${timestamp}-${safeFileName}`

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Server Upload] Starting:', {
        fileName: safeFileName,
        mimeType: file.type,
        sizeBytes: file.size,
        key,
      })
    }

    // Create R2 client
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    })

    // Convert File to Buffer
    const fileBuffer = await file.arrayBuffer()

    // Upload to R2
    try {
      await client.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: new Uint8Array(fileBuffer),
        ContentType: file.type,
      }))

      if (process.env.NODE_ENV !== 'production') {
        console.log('[Server Upload] Success:', { key, size: file.size })
      }

      return NextResponse.json({
        success: true,
        storageProvider: 'r2',
        key,
        bucket: R2_BUCKET_NAME,
        fileName: safeFileName,
        mimeType: file.type,
        sizeBytes: file.size,
      })
    } catch (err: any) {
      console.error('[Server Upload] R2 error:', err.message, err.Code || err.$metadata?.httpStatusCode)
      return NextResponse.json(
        {
          success: false,
          error: 'R2 upload failed',
          errorName: err.name,
          errorMessage: err.message,
          errorCode: err.Code || err.$metadata?.httpStatusCode,
        },
        { status: 500 }
      )
    }
  } catch (err: any) {
    console.error('[Server Upload] Error:', err.message, err.stack)
    return NextResponse.json(
      { error: `Upload failed: ${err.message}` },
      { status: 500 }
    )
  }
}
