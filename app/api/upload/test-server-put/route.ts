import { NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess } from '@/lib/admin-access.server'

export const runtime = 'nodejs'

async function testR2Upload() {
  const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
  const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY
  const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
  const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'easyplus-uploads'

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return {
      success: false,
      errorName: 'ConfigurationError',
      errorMessage: 'R2 not configured',
      errorCode: 503,
    }
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

  const testKey = 'uploads/debug/server-test.txt'
  const testBody = 'hello'

  try {
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: testKey,
      Body: testBody,
    }))

    return {
      success: true,
      key: testKey,
      bucket: R2_BUCKET_NAME,
    }
  } catch (err: any) {
    return {
      success: false,
      errorName: err.name,
      errorMessage: err.message,
      errorCode: err.Code || err.$metadata?.httpStatusCode,
    }
  }
}

async function canRunTest() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return Boolean(user && (await getAdminAccess(user.id))?.isMainAdmin)
}

export async function POST() {
  if (!(await canRunTest())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(await testR2Upload())
}

export async function GET() {
  if (!(await canRunTest())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const result = await testR2Upload()
  return NextResponse.json(result, { status: result.success ? 200 : 500 })
}
