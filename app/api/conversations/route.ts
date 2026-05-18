import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const db = supabase as any
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: conversations, error } = await db
      .from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (error) throw error

    return NextResponse.json(conversations)
  } catch (error: any) {
    console.error('Conversations GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const db = supabase as any
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { title, model, reasoningMode } = await request.json()

    const { data: conversation, error } = await db
      .from('conversations')
      .insert({
        user_id: user.id,
        title: title || 'New Conversation',
        model_used: model,
        ...(reasoningMode ? { reasoning_mode: reasoningMode } : {}),
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(conversation)
  } catch (error: any) {
    console.error('Conversations POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
