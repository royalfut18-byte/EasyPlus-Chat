import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { runBackfill } from '@/lib/ai/backfill-memory'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await createServiceClient() as any

    const { data: profile } = await db
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { userId, conversationId, dryRun, limit, force } = body

    console.log('[Admin Backfill] Starting:', { userId, conversationId, dryRun, limit, force, adminId: user.id })

    const progress = await runBackfill(db, {
      userId: userId || undefined,
      conversationId: conversationId || undefined,
      dryRun: dryRun ?? false,
      limit: limit || undefined,
      force: force ?? false,
    })

    return NextResponse.json({
      success: true,
      progress,
    })
  } catch (error: any) {
    console.error('[Admin Backfill] Error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await createServiceClient() as any

    const { data: profile } = await db
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Return stats about what needs backfilling
    const { count: totalConversations } = await db
      .from('conversations')
      .select('*', { count: 'exact', head: true })

    const { count: processedConversations } = await db
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .not('rolling_summary', 'is', null)

    const { count: totalMemories } = await db
      .from('conversation_memories')
      .select('*', { count: 'exact', head: true })

    const { count: totalChunks } = await db
      .from('memory_chunks')
      .select('*', { count: 'exact', head: true })

    const { count: totalAttachments } = await db
      .from('attachments')
      .select('*', { count: 'exact', head: true })

    return NextResponse.json({
      totalConversations: totalConversations || 0,
      processedConversations: processedConversations || 0,
      unprocessed: (totalConversations || 0) - (processedConversations || 0),
      totalMemories: totalMemories || 0,
      totalChunks: totalChunks || 0,
      totalAttachments: totalAttachments || 0,
    })
  } catch (error: any) {
    console.error('[Admin Backfill] Stats error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
