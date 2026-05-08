import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
      .select('credits')
      .eq('id', id)
      .single<{ credits: number }>()

    if (!targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ credits: targetProfile.credits + amount })
      .eq('id', id)

    if (updateError) throw updateError

    const { data: targetUser } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('id', id)
      .single<{ user_id: string }>()

    if (targetUser) {
      await supabase.from('credit_transactions').insert({
        user_id: targetUser.user_id,
        amount,
        type: amount > 0 ? 'grant' : 'deduction',
        description: reason || 'Manual adjustment by admin',
      })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Admin credits PATCH error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
