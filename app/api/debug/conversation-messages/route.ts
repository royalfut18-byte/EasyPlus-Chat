import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MARKER_CONTENTS = new Set([
  '__ARTIFACT_LOADING__',
  '__ASSISTANT_LOADING__',
  '__LONG_TASK_LOADING__',
  '__RECOVERY_POLLING__',
])

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const conversationId = request.nextUrl.searchParams.get('conversationId')
  if (!conversationId) {
    return NextResponse.json({ error: 'Missing conversationId param' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabase as any
  const { data: rawMessages, error } = await db
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const messages: any[] = rawMessages || []

  const isMarker = (c: string) => !c || MARKER_CONTENTS.has(c) || c.trim() === '...' || c.trim() === ''
  const isReal = (c: string) => c && c.trim().length > 20 && !MARKER_CONTENTS.has(c) && c.trim() !== '...'

  const removed: { id: string; role: string; reason: string; contentPreview: string }[] = []
  const cleaned = messages.filter(m => {
    if (m.role !== 'assistant') return true
    const content = m.content || ''

    if (isMarker(content)) {
      const age = Date.now() - new Date(m.created_at || 0).getTime()
      if (age > 60_000) {
        removed.push({ id: m.id, role: m.role, reason: 'stale marker (>60s)', contentPreview: content.substring(0, 60) })
        return false
      }
    }

    if (content.trim() === '...' || MARKER_CONTENTS.has(content)) {
      removed.push({ id: m.id, role: m.role, reason: 'marker constant', contentPreview: content.substring(0, 60) })
      return false
    }

    return true
  })

  const roleCounts: Record<string, number> = {}
  const statusCounts: Record<string, number> = {}
  for (const m of messages) {
    roleCounts[m.role] = (roleCounts[m.role] || 0) + 1
    statusCounts[m.status || 'null'] = (statusCounts[m.status || 'null'] || 0) + 1
  }

  return NextResponse.json({
    conversationId,
    rawMessageCount: messages.length,
    cleanedMessageCount: cleaned.length,
    removedCount: removed.length,
    roleCounts,
    statusCounts,
    removed,
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      contentLength: (m.content || '').length,
      contentPreview: (m.content || '').substring(0, 120),
      isReal: isReal(m.content || ''),
      isMarker: isMarker(m.content || ''),
      status: m.status || null,
      request_id: m.request_id || null,
      client_message_id: m.client_message_id || null,
      parent_message_id: m.parent_message_id || null,
      order_index: m.order_index,
      created_at: m.created_at,
      updated_at: m.updated_at || null,
    })),
  })
}
