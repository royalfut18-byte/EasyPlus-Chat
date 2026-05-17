import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Message } from '@/types/models'

const MARKER_CONTENTS = new Set([
  '__ARTIFACT_LOADING__',
  '__ASSISTANT_LOADING__',
  '__LONG_TASK_LOADING__',
  '__RECOVERY_POLLING__',
])

const STALE_THRESHOLD_MS = 60_000

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: rawMessages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)

    if (error) throw error

    const messages = (rawMessages || []).map((m: any) => ({
      ...m,
      attachments: m.attachments || [],
    })) as Message[]
    const filtered = messages.filter(m => m?.conversation_id === id)

    // Server-side sort with robust tie-breaking
    filtered.sort((a, b) => {
      const ai = typeof a.order_index === 'number' ? a.order_index : Number.MAX_SAFE_INTEGER
      const bi = typeof b.order_index === 'number' ? b.order_index : Number.MAX_SAFE_INTEGER
      if (ai !== bi) return ai - bi

      const at = new Date(a.created_at || 0).getTime()
      const bt = new Date(b.created_at || 0).getTime()
      if (at !== bt) return at - bt

      const roleRank = (role: string) => role === 'user' ? 0 : role === 'assistant' ? 1 : 2
      const rr = roleRank(a.role) - roleRank(b.role)
      if (rr !== 0) return rr

      return String(a.id || '').localeCompare(String(b.id || ''))
    })

    // Server-side cleanup: REQUEST-SCOPED marker removal
    // NEVER remove assistant messages that have real content (>20 chars, not a marker)
    // Only remove markers when same request_id already has real content, or marker is stale
    const isServerMarker = (c: string) => MARKER_CONTENTS.has(c) || c.trim() === '...' || c.trim() === ''
    const isServerReal = (c: string) => c.trim().length > 20 && !MARKER_CONTENTS.has(c) && c.trim() !== '...'

    const requestIdsWithContent = new Set<string>()
    for (const m of filtered) {
      if (m.role === 'assistant' && m.request_id && m.content && isServerReal(m.content)) {
        requestIdsWithContent.add(m.request_id)
      }
    }

    const now = Date.now()
    const cleaned = filtered.filter(m => {
      if (m.role !== 'assistant') return true
      const content = m.content || ''

      // ALWAYS keep assistant messages with real content regardless of status/request_id/parent_message_id
      if (isServerReal(content)) {
        // If status is stale 'generating' but has real content, mark as completed
        // but preserve the content exactly as-is (never truncate or replace)
        if (m.status === 'generating') {
          const age = now - new Date(m.updated_at || m.created_at || 0).getTime()
          if (age > STALE_THRESHOLD_MS) {
            m.status = 'completed' as any
          }
        }
        return true
      }

      // Below this: content is empty, short, or a marker

      // Stale generating with no real content — mark as interrupted
      if (m.status === 'generating' && !isServerReal(content)) {
        const age = now - new Date(m.updated_at || m.created_at || 0).getTime()
        if (age > STALE_THRESHOLD_MS) {
          m.status = 'error' as any
          m.content = 'Response interrupted. You can retry this message.'
          return true
        }
        // Still actively generating (<60s) — keep it
        return true
      }

      // It's a marker/empty — only remove if same request_id already has real content
      if (m.request_id && requestIdsWithContent.has(m.request_id)) return false

      // Remove stale orphan markers (>60s old, no request_id match)
      if (isServerMarker(content)) {
        const age = now - new Date(m.created_at || 0).getTime()
        if (age > STALE_THRESHOLD_MS) return false
      }

      return true
    })

    if (process.env.NODE_ENV !== 'production') {
      const allAssistant = filtered.filter(m => m.role === 'assistant')
      const realAssistant = allAssistant.filter(m => m.content && isServerReal(m.content))
      const emptyAssistant = allAssistant.filter(m => !m.content || isServerMarker(m.content))
      const markerCount = allAssistant.filter(m => isServerMarker(m.content || '')).length
      console.log('[Conversations API] Load:', {
        conversationId: id,
        totalMessages: filtered.length,
        rawAssistantCount: allAssistant.length,
        realAssistantCount: realAssistant.length,
        emptyAssistantCount: emptyAssistant.length,
        markersRemoved: markerCount,
        returned: cleaned.length,
      })
    }

    return NextResponse.json(cleaned)
  } catch (error: any) {
    console.error('Messages GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await supabase.from('messages').delete().eq('conversation_id', id)

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Conversation DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
