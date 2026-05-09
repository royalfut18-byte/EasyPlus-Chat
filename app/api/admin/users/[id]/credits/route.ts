import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type RouteContext = {
  params: Promise<{ id: string }>
}

type AdminProfile = {
  role: string
}

type TargetProfile = {
  id: string
  user_id: string
  credits: number
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const { amount, reason } = await request.json()

    if (typeof amount !== 'number' || Number.isNaN(amount)) {
      return NextResponse.json({ error: 'Invalid credit amount' }, { status: 400 })
    }

    const supabase = await createClient()
    const db = supabase as any

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (profileError || !profile || (profile as AdminProfile).role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: targetProfile, error: targetError } = await db
      .from('profiles')
      .select('id, user_id, credits')
      .eq('id', id)
      .single()

    if (targetError || !targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const typedTarget = targetProfile as TargetProfile
    const newCredits = typedTarget.credits + amount

    const { error: updateError } = await db
      .from('profiles')
      .update({ credits: newCredits })
      .eq('id', id)

    if (updateError) {
      throw updateError
    }

    const { error: transactionError } = await db.from('credit_transactions').insert({
      user_id: typedTarget.user_id,
      amount,
      type: amount > 0 ? 'grant' : 'deduction',
      description: reason || 'Manual adjustment by admin',
    })

    if (transactionError) {
      throw transactionError
    }

    return NextResponse.json({ success: true, credits: newCredits })
  } catch (error: any) {
    console.error('Admin credits update error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to update credits' },
      { status: 500 }
    )
  }
}
