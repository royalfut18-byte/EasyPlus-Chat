import { getScopedProfiles, type AdminAccess } from '@/lib/admin-access.server'
import { normalizeEntitlement } from '@/lib/account-entitlements.server'

export interface AdminStatistics {
  totalUsers: number
  totalMessages: number
  unlimitedAccounts: number
  finiteCreditsRemaining: number
}

export async function getAdminStatistics(access: AdminAccess): Promise<AdminStatistics> {
  const profiles = await getScopedProfiles(access)
  const userIds = profiles.map((profile) => profile.user_id)
  if (userIds.length === 0) {
    return { totalUsers: 0, totalMessages: 0, unlimitedAccounts: 0, finiteCreditsRemaining: 0 }
  }

  const { data: conversations, error: conversationError } = await access.db
    .from('conversations')
    .select('id')
    .in('user_id', userIds)
  if (conversationError) throw conversationError

  const conversationIds = (conversations || []).map((conversation: any) => conversation.id)
  let totalMessages = 0
  if (conversationIds.length > 0) {
    const { count, error } = await access.db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .in('conversation_id', conversationIds)
    if (error) throw error
    totalMessages = count || 0
  }

  return {
    totalUsers: profiles.filter((profile) => profile.role === 'user').length,
    totalMessages,
    unlimitedAccounts: profiles.filter((profile) => normalizeEntitlement(profile).unlimitedCredits).length,
    finiteCreditsRemaining: profiles
      .filter((profile) => !normalizeEntitlement(profile).unlimitedCredits)
      .reduce((sum, profile) => sum + Math.max(0, profile.credits || 0), 0),
  }
}
