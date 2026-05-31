import { NextResponse } from 'next/server'
import { isR2Configured, createPresignedUploadUrl } from '@/lib/storage/r2'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess } from '@/lib/admin-access.server'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await getAdminAccess(user.id))?.isMainAdmin) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isR2Configured()) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 503 })
  }

  try {
    const testKey = `_test/${Date.now()}-presign-test.txt`
    const result = await createPresignedUploadUrl({
      key: testKey,
      mimeType: 'text/plain',
      sizeBytes: 100,
    })

    const url = new URL(result.uploadUrl)
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')
    const hasChecksumParams = result.uploadUrl.includes('x-amz-checksum') || result.uploadUrl.includes('x-amz-sdk-checksum')

    return NextResponse.json({
      uploadUrlOrigin: url.origin,
      key: result.key,
      signedHeaders,
      hasChecksumParams,
      expiresIn: result.expiresIn,
    })
  } catch (err: any) {
    return NextResponse.json({
      error: err.message,
    }, { status: 500 })
  }
}
