import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

type AdminProfile = {
  role: string
}

export async function GET(request: NextRequest) {
  try {
    // Step 1: Authenticate requesting user
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      console.error('[Admin Users API] Unauthorized:', userError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Step 2: Verify admin role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    const typedProfile = profile as AdminProfile | null

    if (!typedProfile || typedProfile.role !== 'admin') {
      console.error('[Admin Users API] Forbidden: user is not admin')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Step 3: Create service role client (server-side only)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[Admin Users API] Missing Supabase environment variables')
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

    // Step 4: Fetch all auth users using service role
    console.log('[Admin Users API] Fetching all users with service role')
    const { data: authData, error: authError } = await adminClient.auth.admin.listUsers()

    if (authError) {
      console.error('[Admin Users API] Failed to list auth users:', authError)
      throw new Error(`Failed to fetch auth users: ${authError.message}`)
    }

    const authUsers = authData?.users || []
    console.log('[Admin Users API] Found', authUsers.length, 'auth users')

    // Step 5: Fetch all profiles
    const { data: profiles, error: profilesError } = await adminClient
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (profilesError) {
      console.error('[Admin Users API] Failed to fetch profiles:', profilesError)
      throw new Error(`Failed to fetch profiles: ${profilesError.message}`)
    }

    console.log('[Admin Users API] Found', profiles?.length || 0, 'profiles')

    // Step 6: Fetch conversations and message counts
    const { data: conversations } = await adminClient
      .from('conversations')
      .select('id, user_id')

    const { data: messages } = await adminClient
      .from('messages')
      .select('conversation_id, role')

    // Build conversation map: user_id -> conversation_ids[]
    const userConversations = new Map<string, string[]>()
    conversations?.forEach((conv: any) => {
      if (!userConversations.has(conv.user_id)) {
        userConversations.set(conv.user_id, [])
      }
      userConversations.get(conv.user_id)!.push(conv.id)
    })

    // Build message counts per user
    const userMessageCounts = new Map<string, number>()
    const userConversationCounts = new Map<string, number>()

    authUsers.forEach(authUser => {
      const convIds = userConversations.get(authUser.id) || []
      userConversationCounts.set(authUser.id, convIds.length)

      const messageCount = messages?.filter(
        (msg: any) => msg.role === 'user' && convIds.includes(msg.conversation_id)
      ).length || 0
      userMessageCounts.set(authUser.id, messageCount)
    })

    // Step 7: Merge auth users with profiles and stats
    const usersWithDetails = await Promise.all(
      authUsers.map(async (authUser: any) => {
        // Find matching profile
        let userProfile = profiles?.find((p: any) => p.user_id === authUser.id)

        // If no profile exists, create one with defaults
        if (!userProfile) {
          console.warn('[Admin Users API] Creating missing profile for user:', authUser.id)
          const { data: newProfile, error: createError } = await adminClient
            .from('profiles')
            .upsert({
              user_id: authUser.id,
              display_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'User',
              role: 'user',
              credits: 1000,
              unlimited_credits: false,
              subscription_tier: 'free',
            }, {
              onConflict: 'user_id',
              ignoreDuplicates: false,
            })
            .select()
            .single()

          if (createError) {
            console.error('[Admin Users API] Failed to create missing profile:', createError)
          } else {
            userProfile = newProfile
          }
        }

        return {
          id: userProfile?.id || authUser.id,
          user_id: authUser.id,
          email: authUser.email || 'N/A',
          display_name: userProfile?.display_name || authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'N/A',
          role: userProfile?.role || 'user',
          credits: userProfile?.credits || 0,
          unlimited_credits: userProfile?.unlimited_credits || false,
          subscription_tier: userProfile?.subscription_tier || 'free',
          created_at: userProfile?.created_at || authUser.created_at,
          last_sign_in_at: authUser.last_sign_in_at,
          message_count: userMessageCounts.get(authUser.id) || 0,
          conversation_count: userConversationCounts.get(authUser.id) || 0,
        }
      })
    )

    console.log('[Admin Users API] Returning', usersWithDetails.length, 'users with details')
    return NextResponse.json(usersWithDetails)
  } catch (error: any) {
    console.error('[Admin Users API] Fatal error:', {
      message: error.message,
      stack: error.stack,
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
