import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess, canManageTarget } from '@/lib/admin-access.server'

export async function DELETE(request: NextRequest) {
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

    // Extract target id from the URL path (route: /api/admin/users/[id]/delete)
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    const targetUserId = parts[parts.length - 2]

    const { data: profile, error: profileError } = await access.db
      .from('profiles')
      .select('user_id, role, owner_sub_admin_id')
      .eq('user_id', targetUserId)
      .single()

    if (profileError) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Ensure sub-admins cannot delete outside their scope
    if (!canManageTarget(access, profile)) {
      return NextResponse.json({ error: 'Insufficient permissions to delete this account' }, { status: 403 })
    }

    // Delete profile row (non-destructive to messages/conversations)
    const { error: deleteProfileError } = await access.db
      .from('profiles')
      .delete()
      .eq('user_id', targetUserId)

    if (deleteProfileError) {
      return NextResponse.json({ error: `Failed to delete profile: ${deleteProfileError.message}` }, { status: 500 })
    }

    // Delete auth user
    const { error: deleteAuthError } = await access.db.auth.admin.deleteUser(targetUserId)
    if (deleteAuthError) {
      return NextResponse.json({ error: `Failed to delete auth user: ${deleteAuthError.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Admin] Delete user failed:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
