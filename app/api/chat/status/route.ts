import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MARKER_CONTENTS = new Set([
  '__ARTIFACT_LOADING__',
  '__ASSISTANT_LOADING__',
  '__LONG_TASK_LOADING__',
  '__RECOVERY_POLLING__',
])

function isRealContent(content: string | null): boolean {
  if (!content) return false
  if (content.length <= 10) return false
  if (MARKER_CONTENTS.has(content)) return false
  return true
}

export async function GET(request: NextRequest) {
  try {
    const requestId = request.nextUrl.searchParams.get('requestId')
    const conversationId = request.nextUrl.searchParams.get('conversationId')

    if (!requestId && !conversationId) {
      return NextResponse.json({ error: 'Missing requestId or conversationId' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = supabase as any

    if (requestId) {
      const { data: messages } = await db
        .from('messages')
        .select('id, content, status, role, created_at')
        .eq('request_id', requestId)
        .eq('role', 'assistant')
        .limit(1)
        .single()

      if (messages) {
        const content = messages.content
        // Never return marker content as a real found response
        if (isRealContent(content)) {
          return NextResponse.json({
            found: true,
            status: messages.status || 'completed',
            content: content,
            messageId: messages.id,
          })
        }
        // Message exists but content is a marker or empty — check staleness
        const age = Date.now() - new Date(messages.created_at || 0).getTime()
        if (age > 60_000 && messages.status === 'generating') {
          return NextResponse.json({ found: true, status: 'error', content: null, messageId: messages.id })
        }
        // Still actively generating (< 60s)
        return NextResponse.json({ found: true, status: messages.status || 'generating', content: null, messageId: messages.id })
      }

      return NextResponse.json({ found: false, status: 'pending' })
    }

    if (conversationId) {
      const { data: messages } = await db
        .from('messages')
        .select('id, content, status, role, created_at')
        .eq('conversation_id', conversationId)
        .eq('role', 'assistant')
        .order('order_index', { ascending: false })
        .limit(1)
        .single()

      if (messages && isRealContent(messages.content)) {
        return NextResponse.json({
          found: true,
          status: messages.status || 'completed',
          content: messages.content,
          messageId: messages.id,
        })
      }

      return NextResponse.json({ found: false, status: 'pending' })
    }

    return NextResponse.json({ found: false, status: 'unknown' })
  } catch (error: any) {
    console.error('[Chat Status] Error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
