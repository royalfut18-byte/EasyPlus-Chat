import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    // Authenticate the requesting user
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if requesting user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if ((profile as any)?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get request body
    const { email, password, displayName, role, credits, unlimitedCredits } = await request.json()

    // Validate required fields
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Create admin client using service role (server-side only)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Missing Supabase environment variables')
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // Create the auth user
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email for admin-created accounts
      user_metadata: {
        display_name: displayName || email.split('@')[0],
      },
    })

    if (createError || !newUser.user) {
      console.error('Failed to create user:', createError)
      return NextResponse.json(
        { error: createError?.message || 'Failed to create user' },
        { status: 400 }
      )
    }

    // Create profile
    const { error: profileError } = await adminClient.from('profiles').insert({
      user_id: newUser.user.id,
      display_name: displayName || email.split('@')[0],
      credits: credits || 1000,
      unlimited_credits: unlimitedCredits || false,
      subscription_tier: 'free',
      role: role || 'user',
    })

    if (profileError) {
      console.error('Failed to create profile:', profileError)
      // Try to clean up the auth user if profile creation fails
      await adminClient.auth.admin.deleteUser(newUser.user.id)
      return NextResponse.json(
        { error: 'Failed to create user profile' },
        { status: 500 }
      )
    }

    // Create initial credit transaction if credits were granted
    if (credits && credits > 0) {
      await adminClient.from('credit_transactions').insert({
        user_id: newUser.user.id,
        amount: credits,
        type: 'grant',
        description: 'Initial credits granted by admin',
      })
    }

    // Return safe user data
    return NextResponse.json({
      id: newUser.user.id,
      email: newUser.user.email,
      displayName: displayName || email.split('@')[0],
      role: role || 'user',
      credits: credits || 1000,
      unlimitedCredits: unlimitedCredits || false,
      created_at: newUser.user.created_at,
    })
  } catch (error: any) {
    console.error('Create user error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
