import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess, sanitizeRequestedRole } from '@/lib/admin-access.server'
import { DEFAULT_FINITE_CREDITS } from '@/lib/account-entitlements.server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const access = await getAdminAccess(user.id)
    if (!access) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const email = String(body.email || '').trim()
    const password = String(body.password || '')
    const displayName = String(body.displayName || '').trim() || email.split('@')[0]
    const role = sanitizeRequestedRole(access, body.role)
    // Default to unlimited credits for new accounts unless explicitly set false
    const unlimitedCredits = body.unlimitedCredits === undefined ? true : body.unlimitedCredits === true
    const accountExpiresAt = body.accountExpiresAt ? new Date(body.accountExpiresAt).toISOString() : null
    const ownerSubAdminId = role === 'user'
      ? access.isSubAdmin
        ? access.actor.userId
        : body.ownerSubAdminId || null
      : null

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    if (ownerSubAdminId && access.isMainAdmin) {
      const { data: owner } = await access.db
        .from('profiles')
        .select('user_id, role')
        .eq('user_id', ownerSubAdminId)
        .single()
      if (!owner || owner.role !== 'sub_admin') {
        return NextResponse.json({ error: 'Assigned owner must be a sub-admin' }, { status: 400 })
      }
    }

    const { data: newUser, error: createError } = await access.db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    })

    if (createError || !newUser.user) {
      return NextResponse.json({ error: createError?.message || 'Failed to create auth user' }, { status: 400 })
    }

    const credits = unlimitedCredits ? 0 : DEFAULT_FINITE_CREDITS
    const { error: profileError } = await access.db
      .from('profiles')
      .upsert({
        user_id: newUser.user.id,
        display_name: displayName,
        role,
        credits,
        unlimited_credits: unlimitedCredits,
        subscription_tier: unlimitedCredits ? 'unlimited' : 'pro',
        account_status: 'active',
        account_expires_at: accountExpiresAt,
        owner_sub_admin_id: ownerSubAdminId,
        created_by: access.actor.userId,
      }, { onConflict: 'user_id' })

    if (profileError) {
      await access.db.auth.admin.deleteUser(newUser.user.id)
      return NextResponse.json({ error: `Profile creation failed: ${profileError.message}` }, { status: 500 })
    }

    if (!unlimitedCredits && credits > 0) {
      await access.db.from('credit_transactions').insert({
        user_id: newUser.user.id,
        amount: credits,
        type: 'grant',
        description: 'Initial credits granted on account creation',
      })
    }

    return NextResponse.json({
      id: newUser.user.id,
      email: newUser.user.email,
      displayName,
      role,
      credits,
      unlimitedCredits,
      accountExpiresAt,
      ownerSubAdminId,
      created_at: newUser.user.created_at,
    })
  } catch (error: any) {
    console.error('[Admin] Create user failed:', error.message)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
