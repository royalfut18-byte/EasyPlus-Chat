import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ocrAttachmentPages } from '@/lib/ai/pdf-ocr'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const db = await createServiceClient() as any
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const entitlementBlock = getEntitlementBlockResponse(await getAccountEntitlement(db, user.id))
    if (entitlementBlock) return entitlementBlock

    const body = await request.json()
    const attachmentId = String(body.attachmentId || '')
    const conversationId = String(body.conversationId || '')
    const pageStart = Number(body.pageStart)
    const pageEnd = Number(body.pageEnd)

    if (!attachmentId || !conversationId || !Number.isFinite(pageStart) || !Number.isFinite(pageEnd)) {
      return NextResponse.json(
        { error: 'Missing required fields: attachmentId, conversationId, pageStart, pageEnd' },
        { status: 400 }
      )
    }

    const { data: conversation } = await db
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .single()

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const result = await ocrAttachmentPages(db, {
      userId: user.id,
      conversationId,
      attachmentId,
      pageStart,
      pageEnd,
    })

    return NextResponse.json({
      success: true,
      attachmentId: result.attachmentId,
      fileName: result.fileName,
      pageStart: result.pageStart,
      pageEnd: result.pageEnd,
      pageCount: result.pageCount,
      pagesProcessed: result.pagesProcessed,
      preview: result.preview,
      extractedTextLength: result.combinedText.length,
      status: result.combinedText ? 'completed' : 'empty',
    })
  } catch (error: any) {
    console.error('[OCR Pages API] Failed:', error.message)
    return NextResponse.json(
      { error: error.message || 'OCR failed' },
      { status: 500 }
    )
  }
}
