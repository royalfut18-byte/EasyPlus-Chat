import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedDownloadUrl, isR2Configured } from '@/lib/storage/r2'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'

export const runtime = 'nodejs'

function firstValue(value: string | null): string | null {
  return value && value.trim() ? value.trim() : null
}

function isUserOwnedStorageKey(key: string, userId: string): boolean {
  return key.startsWith(`uploads/${userId}/`)
}

export async function GET(request: NextRequest) {
  try {
    if (!isR2Configured()) {
      return NextResponse.json({ error: 'File storage is not configured' }, { status: 503 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const entitlementBlock = getEntitlementBlockResponse(await getAccountEntitlement(supabase as any, user.id))
    if (entitlementBlock) return entitlementBlock

    const { searchParams } = new URL(request.url)
    const attachmentId = firstValue(searchParams.get('attachmentId'))
    const directKey = firstValue(searchParams.get('key'))
    const requestedName = firstValue(searchParams.get('name')) || 'download'
    const requestedMime = firstValue(searchParams.get('mimeType')) || 'application/octet-stream'
    const disposition = searchParams.get('download') === '1' ? 'attachment' : 'inline'

    let storageKey: string | null = null
    let fileName = requestedName
    let mimeType = requestedMime

    if (attachmentId) {
      const { data, error } = await supabase
        .from('attachments')
        .select('storage_path, file_name, mime_type, important_details')
        .eq('id', attachmentId)
        .eq('user_id', user.id)
        .limit(1)
        .single()

      const row = data as any
      if (error || !row) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      storageKey = row.storage_path || row.important_details?.storageKey || row.important_details?.storagePath || null
      fileName = row.file_name || fileName
      mimeType = row.mime_type || mimeType
    } else if (directKey) {
      if (!isUserOwnedStorageKey(directKey, user.id)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      storageKey = directKey
    }

    if (!storageKey) {
      return NextResponse.json({ error: 'No stored file is available for this attachment' }, { status: 404 })
    }

    const signedUrl = await createPresignedDownloadUrl(storageKey, 300, {
      fileName,
      mimeType,
      disposition,
    })

    return NextResponse.redirect(signedUrl)
  } catch (error: any) {
    console.error('[Attachment File] Open failed:', error.message)
    return NextResponse.json({ error: error.message || 'Failed to open file' }, { status: 500 })
  }
}
