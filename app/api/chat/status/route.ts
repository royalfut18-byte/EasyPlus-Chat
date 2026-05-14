import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
      // Find assistant message by request_id
      const { data: messages } = await db
        .from('messages')
        .select('id, content, status, role, created_at')
        .eq('request_id', requestId)
        .eq('role', 'assistant')
        .limit(1)
        .single()

      if (messages) {
        return NextResponse.json({
          found: true,
          status: messages.status || 'completed',
          content: messages.content,
          messageId: messages.id,
        })
      }

      return NextResponse.json({ found: false, status: 'pending' })
    }

    // Fallback: find latest assistant message for conversation
    if (conversationId) {
      const { data: messages } = await db
        .from('messages')
        .select('id, content, status, role, created_at')
        .eq('conversation_id', conversationId)
        .eq('role', 'assistant')
        .order('order_index', { ascending: false })
        .limit(1)
        .single()

      if (messages && messages.content && messages.content.length > 10) {
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
