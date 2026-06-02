import 'server-only'

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { readServerEnv } from '@/lib/server-env'

const R2_ACCOUNT_ID = readServerEnv('R2_ACCOUNT_ID')
const R2_ACCESS_KEY_ID = readServerEnv('R2_ACCESS_KEY_ID') || readServerEnv('R2_ACCESS_KEY')
const R2_SECRET_ACCESS_KEY = readServerEnv('R2_SECRET_ACCESS_KEY')
const R2_BUCKET_NAME = readServerEnv('R2_BUCKET_NAME') || 'easyplus-uploads'

export function isR2Configured(): boolean {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)
}

export function getR2ConfigStatus(): { configured: boolean; missing: string[] } {
  const missing = [
    !R2_ACCOUNT_ID && 'R2_ACCOUNT_ID',
    !R2_ACCESS_KEY_ID && 'R2_ACCESS_KEY_ID',
    !R2_SECRET_ACCESS_KEY && 'R2_SECRET_ACCESS_KEY',
  ].filter(Boolean) as string[]

  return { configured: missing.length === 0, missing }
}

function getR2Client(): S3Client {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 environment variables not configured')
  }

  return new S3Client({
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
}

export async function createPresignedUploadUrl(params: {
  key: string
  mimeType: string
  sizeBytes: number
  expiresIn?: number
}): Promise<{ uploadUrl: string; key: string; bucket: string; expiresIn: number }> {
  const { key, expiresIn = 600 } = params
  const client = getR2Client()

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  })

  const uploadUrl = await getSignedUrl(client, command, { expiresIn })

  return {
    uploadUrl,
    key,
    bucket: R2_BUCKET_NAME,
    expiresIn,
  }
}

export async function createPresignedDownloadUrl(
  key: string,
  expiresIn = 3600,
  options: { fileName?: string; mimeType?: string; disposition?: 'inline' | 'attachment' } = {}
): Promise<string> {
  const client = getR2Client()
  const safeFileName = options.fileName?.replace(/["\r\n]/g, '_')

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ResponseContentType: options.mimeType,
    ResponseContentDisposition: safeFileName
      ? `${options.disposition || 'inline'}; filename="${safeFileName}"`
      : options.disposition,
  })

  return getSignedUrl(client, command, { expiresIn })
}

export async function uploadObjectToR2(params: {
  key: string
  body: Buffer | Uint8Array
  mimeType: string
}): Promise<{ key: string; bucket: string }> {
  const client = getR2Client()

  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: params.key,
    Body: params.body,
    ContentType: params.mimeType,
  }))

  return {
    key: params.key,
    bucket: R2_BUCKET_NAME,
  }
}

export async function downloadObjectFromR2(key: string): Promise<Buffer> {
  const client = getR2Client()
  const response = await client.send(new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  }))

  if (!response.Body) {
    throw new Error('Stored object body is empty')
  }

  return Buffer.from(await response.Body.transformToByteArray())
}
