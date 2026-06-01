import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess, getScopedProfiles } from '@/lib/admin-access.server'
import { normalizeEntitlement } from '@/lib/account-entitlements.server'
import { getAdminStatisticsData } from '@/lib/admin-statistics.server'

async function listAllAuthUsers(db: any) {
  const users: any[] = []
  const perPage = 1000
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const batch = data?.users || []
    users.push(...batch)
    if (batch.length < perPage) return users
  }
}

async function listAllConversations(db: any) {
  const conversations: Array<{ id: string; user_id: string }> = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('conversations')
      .select('id, user_id')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    const batch = data || []
    conversations.push(...batch)
    if (batch.length < pageSize) return conversations
  }
}

async function countMessagesForConversations(db: any, conversationIds: string[]) {
  let total = 0
  for (let index = 0; index < conversationIds.length; index += 200) {
    const { count, error } = await db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .in('conversation_id', conversationIds.slice(index, index + 200))
    if (error) throw error
    total += count || 0
  }
  return total
}

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
    const { stats, usageByUserId } = await getAdminStatisticsData(access, profiles)
    const authUsers = await listAllAuthUsers(access.db)
    const visibleUserIds = new Set(profiles.map((profile) => profile.user_id))
    const visibleAuthUsers = authUsers.filter((authUser: any) => visibleUserIds.has(authUser.id))

    if (access.isMainAdmin) {
      try {
        const authUserIds = new Set(authUsers.map((authUser: any) => authUser.id))
        const allConversations = await listAllConversations(access.db)
        const orphanedConversationIds = allConversations
          .filter((conversation: any) => !visibleUserIds.has(conversation.user_id))
          .map((conversation: any) => conversation.id)
        const messagesInOrphanedConversations = await countMessagesForConversations(access.db, orphanedConversationIds)

        console.info('[Admin Stats Audit]', {
          profileAccounts: profiles.length,
          authAccounts: authUsers.length,
          profilesWithoutAuthUsers: profiles.filter((profile) => !authUserIds.has(profile.user_id)).length,
          authUsersWithoutProfiles: authUsers.filter((authUser: any) => !visibleUserIds.has(authUser.id)).length,
          conversationsWithoutProfiles: orphanedConversationIds.length,
          messagesInConversationsWithoutProfiles: messagesInOrphanedConversations,
          chatsOwnedByProfileAccounts: stats.totalChats,
          userPromptsOwnedByProfileAccounts: stats.userPrompts,
          totalMessagesOwnedByProfileAccounts: stats.totalMessages,
        })
      } catch (auditError) {
        console.warn('[Admin Stats Audit] Failed to load diagnostics:', auditError)
      }
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
        user_prompt_count: usageByUserId.get(profile.user_id)?.userPromptCount || 0,
        total_message_count: usageByUserId.get(profile.user_id)?.totalMessageCount || 0,
        conversation_count: usageByUserId.get(profile.user_id)?.chatCount || 0,
      }
    })

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
