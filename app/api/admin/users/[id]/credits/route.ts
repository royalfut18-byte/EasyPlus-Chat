import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageTarget, getAdminAccess } from '@/lib/admin-access.server'

type RouteContext = {
  params: Promise<{ id: string }>
}

type TargetProfile = {
  id: string
  user_id: string
  credits: number
  role: 'user' | 'sub_admin' | 'admin'
  owner_sub_admin_id: string | null
  unlimited_credits: boolean
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const { amount, reason } = await request.json()

    if (typeof amount !== 'number' || Number.isNaN(amount)) {
      return NextResponse.json({ error: 'Invalid credit amount' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const access = await getAdminAccess(user.id)
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: targetProfile, error: targetError } = await access.db
      .from('profiles')
      .select('id, user_id, credits, role, owner_sub_admin_id, unlimited_credits')
      .eq('id', id)
      .single()

    if (targetError || !targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const typedTarget = targetProfile as TargetProfile
    if (!canManageTarget(access, typedTarget)) {
      return NextResponse.json({ error: 'You cannot manage this account' }, { status: 403 })
    }
    if (typedTarget.unlimited_credits) {
      return NextResponse.json({ error: 'Unlimited accounts do not use finite credit adjustments' }, { status: 400 })
    }
    const newCredits = typedTarget.credits + amount

    const { error: updateError } = await access.db
      .from('profiles')
      .update({ credits: newCredits })
      .eq('id', id)

    if (updateError) {
      throw updateError
    }

    const { error: transactionError } = await access.db.from('credit_transactions').insert({
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
