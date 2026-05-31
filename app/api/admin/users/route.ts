import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess, getScopedProfiles } from '@/lib/admin-access.server'
import { normalizeEntitlement } from '@/lib/account-entitlements.server'

export async function GET() {
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

    const profiles = await getScopedProfiles(access)
    const { data: authData, error: authError } = await access.db.auth.admin.listUsers()
    if (authError) throw authError

    const authUsers = authData?.users || []
    const visibleUserIds = new Set(profiles.map((profile) => profile.user_id))
    const visibleAuthUsers = authUsers.filter((authUser: any) => visibleUserIds.has(authUser.id))

    let conversations: Array<{ id: string; user_id: string }> = []
    if (visibleUserIds.size > 0) {
      const { data, error } = await access.db
        .from('conversations')
        .select('id, user_id')
        .in('user_id', Array.from(visibleUserIds))
      if (error) throw error
      conversations = data || []
    }

    const conversationOwner = new Map<string, string>()
    const conversationCounts = new Map<string, number>()
    for (const conversation of conversations || []) {
      conversationOwner.set(conversation.id, conversation.user_id)
      conversationCounts.set(conversation.user_id, (conversationCounts.get(conversation.user_id) || 0) + 1)
    }

    const conversationIds = Array.from(conversationOwner.keys())
    let messages: Array<{ conversation_id: string; role: string }> = []
    if (conversationIds.length > 0) {
      const { data, error } = await access.db
        .from('messages')
        .select('conversation_id, role')
        .in('conversation_id', conversationIds)
      if (error) throw error
      messages = data || []
    }

    const messageCounts = new Map<string, number>()
    for (const message of messages) {
      const ownerId = conversationOwner.get(message.conversation_id)
      if (ownerId) messageCounts.set(ownerId, (messageCounts.get(ownerId) || 0) + 1)
    }

    const authById = new Map(visibleAuthUsers.map((authUser: any) => [authUser.id, authUser]))
    const users = profiles.map((profile) => {
      const authUser: any = authById.get(profile.user_id)
      const entitlement = normalizeEntitlement(profile)
      return {
        id: profile.id,
        user_id: profile.user_id,
        email: authUser?.email || 'N/A',
        display_name: profile.display_name || authUser?.user_metadata?.display_name || authUser?.email?.split('@')[0] || 'User',
        role: profile.role,
        credits: entitlement.credits,
        unlimited_credits: entitlement.unlimitedCredits,
        subscription_tier: entitlement.subscriptionTier,
        account_status: entitlement.status,
        account_expires_at: entitlement.expiresAt,
        owner_sub_admin_id: profile.owner_sub_admin_id,
        created_at: profile.created_at || authUser?.created_at,
        last_sign_in_at: authUser?.last_sign_in_at || null,
        message_count: messageCounts.get(profile.user_id) || 0,
        conversation_count: conversationCounts.get(profile.user_id) || 0,
      }
    })

    const finiteProfiles = profiles.filter((profile) => !normalizeEntitlement(profile).unlimitedCredits)
    const stats = {
      totalUsers: profiles.filter((profile) => profile.role === 'user').length,
      totalMessages: messages.length,
      unlimitedAccounts: profiles.filter((profile) => normalizeEntitlement(profile).unlimitedCredits).length,
      finiteCreditsRemaining: finiteProfiles.reduce((sum, profile) => sum + Math.max(0, profile.credits || 0), 0),
    }

    return NextResponse.json({
      actorRole: access.actor.role,
      users,
      stats,
      subAdmins: access.isMainAdmin
        ? users.filter((entry) => entry.role === 'sub_admin').map((entry) => ({
            user_id: entry.user_id,
            display_name: entry.display_name,
            email: entry.email,
          }))
        : [],
    })
  } catch (error: any) {
    console.error('[Admin Users API] Failed:', error.message)
    return NextResponse.json({ error: 'Failed to load admin users' }, { status: 500 })
  }
}
