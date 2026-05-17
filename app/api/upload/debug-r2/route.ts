import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY
  const hasSecret = !!process.env.R2_SECRET_ACCESS_KEY
  const bucketName = process.env.R2_BUCKET_NAME || 'easyplus-uploads'
  const maxUploadMB = parseInt(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || '512', 10)

  return NextResponse.json({
    hasAccountId: !!accountId,
    hasAccessKeyId: !!accessKeyId,
    hasAccessKeyAlias: !!process.env.R2_ACCESS_KEY,
    hasSecretAccessKey: hasSecret,
    bucketName,
    endpointOrigin: accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null,
    maxUploadMB,
    configured: !!(accountId && accessKeyId && hasSecret),
  })
}
