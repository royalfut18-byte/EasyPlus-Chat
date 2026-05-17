import { NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

export const runtime = 'nodejs'

export async function POST() {
  const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
  const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY
  const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
  const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'easyplus-uploads'

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return NextResponse.json({ success: false, error: 'R2 not configured' }, { status: 503 })
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })

  const testKey = `_test/${Date.now()}-health-check.txt`
  const testBody = `R2 health check at ${new Date().toISOString()}`

  try {
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: testKey,
      Body: testBody,
    }))

    return NextResponse.json({
      success: true,
      key: testKey,
      bucket: R2_BUCKET_NAME,
    })
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      errorName: err.name,
      errorMessage: err.message,
      errorCode: err.Code || err.$metadata?.httpStatusCode,
    }, { status: 500 })
  }
}
