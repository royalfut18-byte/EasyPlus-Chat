import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Message } from '@/types/models'

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
      // 1. Sort by order_index first (nulls last)
      const ai = typeof a.order_index === 'number' ? a.order_index : Number.MAX_SAFE_INTEGER
      const bi = typeof b.order_index === 'number' ? b.order_index : Number.MAX_SAFE_INTEGER
      if (ai !== bi) return ai - bi

      // 2. Sort by created_at
      const at = new Date(a.created_at || 0).getTime()
      const bt = new Date(b.created_at || 0).getTime()
      if (at !== bt) return at - bt

      // 3. User before assistant on tie
      const roleRank = (role: string) => role === 'user' ? 0 : role === 'assistant' ? 1 : 2
      const rr = roleRank(a.role) - roleRank(b.role)
      if (rr !== 0) return rr

      // 4. Sort by id for stability
      return String(a.id || '').localeCompare(String(b.id || ''))
    })

    return NextResponse.json(filtered)
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
