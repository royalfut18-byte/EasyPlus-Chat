import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'

async function getAccessBlock(db: any, userId: string) {
  return getEntitlementBlockResponse(await getAccountEntitlement(db, userId))
}

export async function GET() {
  try {
    const supabase = await createClient()
    const db = supabase as any
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accessBlock = await getAccessBlock(db, user.id)
    if (accessBlock) return accessBlock

    const { data: memories, error } = await db
      .from('user_memories')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ memories: [], tableExists: false })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ memories: memories || [], tableExists: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const db = supabase as any
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accessBlock = await getAccessBlock(db, user.id)
    if (accessBlock) return accessBlock

    const { memory_text, category, importance } = await request.json()

    if (!memory_text || memory_text.trim().length < 3) {
      return NextResponse.json({ error: 'Memory text is required' }, { status: 400 })
    }

    const { data, error } = await db
      .from('user_memories')
      .insert({
        user_id: user.id,
        memory_text: memory_text.trim(),
        category: category || 'general',
        importance: importance || 3,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ memory: data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const db = supabase as any
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accessBlock = await getAccessBlock(db, user.id)
    if (accessBlock) return accessBlock

    const { searchParams } = new URL(request.url)
    const memoryId = searchParams.get('id')
    const clearAll = searchParams.get('clearAll')

    if (clearAll === 'true') {
      const { error } = await db
        .from('user_memories')
        .delete()
        .eq('user_id', user.id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ deleted: true, all: true })
    }

    if (!memoryId) {
      return NextResponse.json({ error: 'Memory ID required' }, { status: 400 })
    }

    const { error } = await db
      .from('user_memories')
      .delete()
      .eq('id', memoryId)
      .eq('user_id', user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ deleted: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const db = supabase as any
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accessBlock = await getAccessBlock(db, user.id)
    if (accessBlock) return accessBlock

    const { id, memory_text, category, importance } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'Memory ID required' }, { status: 400 })
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (memory_text) updates.memory_text = memory_text.trim()
    if (category) updates.category = category
    if (importance) updates.importance = importance

    const { data, error } = await db
      .from('user_memories')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ memory: data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
