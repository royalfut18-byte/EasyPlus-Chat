import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export async function PATCH(
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

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single<{ role: string }>()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { amount, reason } = await request.json()

    if (typeof amount !== 'number') {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('credits, user_id')
      .eq('id', id)
      .single()

    if (!targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // @ts-ignore - Supabase type inference issue
    const newCredits: number = targetProfile.credits + amount

    // @ts-ignore - Supabase type inference issue
    const updateResult = await supabase
      .from('profiles')
      // @ts-ignore
      .update({ credits: newCredits })
      .eq('id', id)

    // @ts-ignore - Supabase type inference issue
    const transactionResult = await supabase.from('credit_transactions')
      // @ts-ignore
      .insert({
        user_id: targetProfile.user_id,
        amount,
        type: amount > 0 ? 'grant' : 'deduction',
        description: reason || 'Manual adjustment by admin',
      })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Admin credits PATCH error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
