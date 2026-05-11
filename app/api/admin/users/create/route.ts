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

    // Step 1: Create the auth user
    console.log('[Admin] Creating auth user for:', email)
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email for admin-created accounts
      user_metadata: {
        display_name: displayName || email.split('@')[0],
      },
    })

    if (createError || !newUser.user) {
      console.error('[Admin] Auth user creation failed:', {
        error: createError?.message,
        code: createError?.code,
        status: createError?.status,
      })
      return NextResponse.json(
        { error: createError?.message || 'Failed to create auth user' },
        { status: 400 }
      )
    }

    console.log('[Admin] Auth user created successfully:', newUser.user.id)

    // Step 2: Create/upsert profile (use upsert to handle conflicts and bypass RLS with service role)
    console.log('[Admin] Creating profile for user:', newUser.user.id)
    const profileData = {
      user_id: newUser.user.id,
      display_name: displayName || email.split('@')[0],
      credits: credits || 1000,
      unlimited_credits: unlimitedCredits || false,
      subscription_tier: 'free',
      role: role || 'user',
    }

    const { error: profileError } = await adminClient
      .from('profiles')
      .upsert(profileData, {
        onConflict: 'user_id',
        ignoreDuplicates: false,
      })

    if (profileError) {
      console.error('[Admin] Profile upsert failed:', {
        error: profileError.message,
        code: profileError.code,
        details: profileError.details,
        hint: profileError.hint,
      })
      // Try to clean up the auth user if profile creation fails
      console.log('[Admin] Cleaning up auth user after profile failure')
      await adminClient.auth.admin.deleteUser(newUser.user.id)
      return NextResponse.json(
        { error: `Profile creation failed: ${profileError.message}` },
        { status: 500 }
      )
    }

    console.log('[Admin] Profile created successfully')

    // Step 3: Create initial credit transaction (non-blocking, optional)
    if (credits && credits > 0) {
      console.log('[Admin] Creating credit transaction for:', newUser.user.id)
      const { error: transactionError } = await adminClient
        .from('credit_transactions')
        .insert({
          user_id: newUser.user.id,
          amount: credits,
          type: 'grant',
          description: 'Initial credits granted by admin',
        })

      if (transactionError) {
        // Log but don't fail the user creation
        console.warn('[Admin] Credit transaction failed (non-critical):', {
          error: transactionError.message,
          code: transactionError.code,
        })
      } else {
        console.log('[Admin] Credit transaction created successfully')
      }
    }

    // Return safe user data
    console.log('[Admin] User creation completed successfully:', newUser.user.id)
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
    console.error('[Admin] Create user unexpected error:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    })
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
