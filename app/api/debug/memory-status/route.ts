import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

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

    // Get counts for the authenticated user (or specify userId param)
    const targetUserId = request.nextUrl.searchParams.get('userId') || user.id

    const [
      conversationsResult,
      withPurposeResult,
      withRollingResult,
      conversationMemoriesResult,
      memoryChunksResult,
      contextSnapshotsResult,
      attachmentsResult,
      userMemoriesResult,
    ] = await Promise.all([
      db.from('conversations').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId),
      db.from('conversations').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId).not('purpose_summary', 'is', null),
      db.from('conversations').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId).not('rolling_summary', 'is', null),
      db.from('conversation_memories').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId),
      db.from('memory_chunks').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId),
      db.from('context_snapshots').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId),
      db.from('attachments').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId),
      db.from('user_memories').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId),
    ])

    // Get recent memory examples
    const { data: recentMemories } = await db
      .from('conversation_memories')
      .select('title, content, scope, importance, created_at')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(5)

    // Get recent chunk examples
    const { data: recentChunks } = await db
      .from('memory_chunks')
      .select('summary, source_type, created_at')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(5)

    // Get recent user memories
    const { data: recentUserMems } = await db
      .from('user_memories')
      .select('memory_text, category, importance, created_at')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(5)

    // Get recent conversations with summaries
    const { data: recentConvSummaries } = await db
      .from('conversations')
      .select('id, title, purpose_summary, rolling_summary, last_context_refresh_at')
      .eq('user_id', targetUserId)
      .not('purpose_summary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(5)

    return NextResponse.json({
      targetUserId,
      counts: {
        totalConversations: conversationsResult.count || 0,
        withPurposeSummary: withPurposeResult.count || 0,
        withRollingSummary: withRollingResult.count || 0,
        conversationMemories: conversationMemoriesResult.count || 0,
        memoryChunks: memoryChunksResult.count || 0,
        contextSnapshots: contextSnapshotsResult.count || 0,
        attachments: attachmentsResult.count || 0,
        userMemories: userMemoriesResult.count || 0,
      },
      recentMemoryExamples: (recentMemories || []).map((m: any) => ({
        title: m.title,
        content: m.content?.substring(0, 100),
        scope: m.scope,
        importance: m.importance,
        created_at: m.created_at,
      })),
      recentChunkExamples: (recentChunks || []).map((c: any) => ({
        summary: c.summary?.substring(0, 100),
        source_type: c.source_type,
        created_at: c.created_at,
      })),
      recentUserMemories: (recentUserMems || []).map((m: any) => ({
        memory_text: m.memory_text?.substring(0, 100),
        category: m.category,
        importance: m.importance,
        created_at: m.created_at,
      })),
      recentConversationSummaries: (recentConvSummaries || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        purpose_summary: c.purpose_summary?.substring(0, 100),
        rolling_summary: c.rolling_summary?.substring(0, 100),
        last_refresh: c.last_context_refresh_at,
      })),
    })
  } catch (error: any) {
    console.error('[Debug Memory Status] Error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
