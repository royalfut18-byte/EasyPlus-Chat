import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type AdminProfile = {
  role: string
}

export async function GET(request: NextRequest) {
  try {
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

    const typedProfile = profile as AdminProfile | null

    if (!typedProfile || typedProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: profiles, error } = await db
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    // Fetch emails from auth.users for each profile
    const usersWithEmails = await Promise.all(
      (profiles || []).map(async (profile: any) => {
        try {
          const { data: authUser } = await supabase.auth.admin.getUserById(profile.user_id)
          return {
            ...profile,
            email: authUser?.user?.email || 'N/A',
          }
        } catch (e) {
          return {
            ...profile,
            email: 'N/A',
          }
        }
      })
    )

    return NextResponse.json(usersWithEmails)
  } catch (error: any) {
    console.error('Admin users GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
