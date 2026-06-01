import { getScopedProfiles, type AdminAccess } from '@/lib/admin-access.server'
import { normalizeEntitlement, type AccountProfileRow } from '@/lib/account-entitlements.server'

export interface AdminStatistics {
  totalAccounts: number
  userAccounts: number
  subAdminAccounts: number
  adminAccounts: number
  unlimitedAccounts: number
  finiteCreditsRemaining: number
  totalChats: number
  userPrompts: number
  totalMessages: number
}

export interface AdminUserUsage {
  chatCount: number
  userPromptCount: number
  totalMessageCount: number
}

export interface AdminStatisticsData {
  stats: AdminStatistics
  usageByUserId: Map<string, AdminUserUsage>
}

export const EMPTY_ADMIN_STATISTICS: AdminStatistics = {
  totalAccounts: 0,
  userAccounts: 0,
  subAdminAccounts: 0,
  adminAccounts: 0,
  unlimitedAccounts: 0,
  finiteCreditsRemaining: 0,
  totalChats: 0,
  userPrompts: 0,
  totalMessages: 0,
}

const PAGE_SIZE = 1000
const FILTER_BATCH_SIZE = 200

async function selectAllRows<T>(createQuery: () => any): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await createQuery().range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const batch = (data || []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
}

async function selectAllRowsForValues<T>(
  access: AdminAccess,
  table: string,
  columns: string,
  filterColumn: string,
  values: string[],
): Promise<T[]> {
  const rows: T[] = []
  for (let index = 0; index < values.length; index += FILTER_BATCH_SIZE) {
    const batchValues = values.slice(index, index + FILTER_BATCH_SIZE)
    rows.push(...await selectAllRows<T>(() => access.db
      .from(table)
      .select(columns)
      .in(filterColumn, batchValues)
      .order('id', { ascending: true })))
  }
  return rows
}

export async function getAdminStatistics(access: AdminAccess): Promise<AdminStatistics> {
  return (await getAdminStatisticsData(access)).stats
}

export async function getAdminStatisticsData(
  access: AdminAccess,
  profiles?: AccountProfileRow[],
): Promise<AdminStatisticsData> {
  const scopedProfiles = profiles || await getScopedProfiles(access)
  const userIds = scopedProfiles.map((profile) => profile.user_id)
  const usageByUserId = new Map<string, AdminUserUsage>()

  for (const userId of userIds) {
    usageByUserId.set(userId, { chatCount: 0, userPromptCount: 0, totalMessageCount: 0 })
  }

  let conversations: Array<{ id: string; user_id: string }> = []
  if (userIds.length > 0) {
    conversations = await selectAllRowsForValues(access, 'conversations', 'id, user_id', 'user_id', userIds)
  }

  const conversationOwner = new Map<string, string>()
  for (const conversation of conversations) {
    conversationOwner.set(conversation.id, conversation.user_id)
    const usage = usageByUserId.get(conversation.user_id)
    if (usage) usage.chatCount += 1
  }

  let messages: Array<{ conversation_id: string; role: string }> = []
  const conversationIds = Array.from(conversationOwner.keys())
  if (conversationIds.length > 0) {
    messages = await selectAllRowsForValues(access, 'messages', 'id, conversation_id, role', 'conversation_id', conversationIds)
  }

  for (const message of messages) {
    const ownerId = conversationOwner.get(message.conversation_id)
    const usage = ownerId ? usageByUserId.get(ownerId) : null
    if (!usage) continue
    usage.totalMessageCount += 1
    if (message.role === 'user') usage.userPromptCount += 1
  }

  const stats = {
    totalAccounts: scopedProfiles.length,
    userAccounts: scopedProfiles.filter((profile) => profile.role === 'user').length,
    subAdminAccounts: scopedProfiles.filter((profile) => profile.role === 'sub_admin').length,
    adminAccounts: scopedProfiles.filter((profile) => profile.role === 'admin').length,
    unlimitedAccounts: scopedProfiles.filter((profile) => normalizeEntitlement(profile).unlimitedCredits).length,
    finiteCreditsRemaining: scopedProfiles
      .filter((profile) => !normalizeEntitlement(profile).unlimitedCredits)
      .reduce((sum, profile) => sum + Math.max(0, profile.credits || 0), 0),
    totalChats: conversations.length,
    userPrompts: messages.filter((message) => message.role === 'user').length,
    totalMessages: messages.length,
  }

  return { stats, usageByUserId }
}
