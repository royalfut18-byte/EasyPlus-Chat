import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageTarget, getAdminAccess, sanitizeRequestedRole } from '@/lib/admin-access.server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const access = await getAdminAccess(user.id)
    if (!access) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { data: target } = await access.db
      .from('profiles')
      .select('user_id, role, owner_sub_admin_id')
      .eq('user_id', id)
      .single()

    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (!canManageTarget(access, target)) {
      return NextResponse.json({ error: 'You cannot manage this account' }, { status: 403 })
    }

    const body = await request.json()
    const updates: Record<string, unknown> = {}

    if (body.role !== undefined && access.isMainAdmin) {
      updates.role = sanitizeRequestedRole(access, body.role)
    }
    if (body.credits !== undefined && Number.isFinite(Number(body.credits))) {
      updates.credits = Math.max(0, Number(body.credits))
    }
    if (body.unlimitedCredits !== undefined) {
      updates.unlimited_credits = body.unlimitedCredits === true
      updates.subscription_tier = body.unlimitedCredits === true ? 'unlimited' : 'pro'
      if (body.unlimitedCredits === true) updates.credits = 0
    }
    if (body.accountExpiresAt !== undefined) {
      updates.account_expires_at = body.accountExpiresAt
        ? new Date(body.accountExpiresAt).toISOString()
        : null
    }
    if (body.accountStatus !== undefined && ['active', 'disabled'].includes(body.accountStatus)) {
      updates.account_status = body.accountStatus
    }
    if (body.ownerSubAdminId !== undefined && access.isMainAdmin) {
      const ownerSubAdminId = body.ownerSubAdminId || null
      if (ownerSubAdminId) {
        const { data: owner } = await access.db
          .from('profiles')
          .select('role')
          .eq('user_id', ownerSubAdminId)
          .single()
        if (!owner || owner.role !== 'sub_admin') {
          return NextResponse.json({ error: 'Assigned owner must be a sub-admin' }, { status: 400 })
        }
      }
      updates.owner_sub_admin_id = ownerSubAdminId
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    const { error: updateError } = await access.db
      .from('profiles')
      .update(updates)
      .eq('user_id', id)

    if (updateError) throw updateError
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Admin] Update user failed:', error.message)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
