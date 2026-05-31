import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isR2Configured, createPresignedDownloadUrl } from '@/lib/storage/r2'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    if (!isR2Configured()) {
      return NextResponse.json({ error: 'Cloud storage not configured' }, { status: 503 })
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const entitlementBlock = getEntitlementBlockResponse(await getAccountEntitlement(supabase as any, user.id))
    if (entitlementBlock) return entitlementBlock

    const { key } = await request.json()

    if (!key || typeof key !== 'string') {
      return NextResponse.json({ error: 'Missing key' }, { status: 400 })
    }

    if (!key.startsWith(`uploads/${user.id}/`)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const signedUrl = await createPresignedDownloadUrl(key)

    return NextResponse.json({ url: signedUrl })
  } catch (err: any) {
    console.error('[Upload SignedUrl] Error:', err.message)
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
  }
}
