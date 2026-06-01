import { createServiceClient } from '@/lib/supabase/server'
import {
  getAccountEntitlement,
  type AccountEntitlement,
  type AccountProfileRow,
  type AccountRole,
  PROFILE_ENTITLEMENT_SELECT,
} from '@/lib/account-entitlements.server'

export interface AdminAccess {
  actor: AccountEntitlement
  db: any
  isMainAdmin: boolean
  isSubAdmin: boolean
}

export async function getAdminAccess(userId: string): Promise<AdminAccess | null> {
  const db = await createServiceClient() as any
  const actor = await getAccountEntitlement(db, userId)
  if (!actor || !['admin', 'sub_admin'].includes(actor.role)) return null

  return {
    actor,
    db,
    isMainAdmin: actor.role === 'admin',
    isSubAdmin: actor.role === 'sub_admin',
  }
}

export function canManageTarget(access: AdminAccess, target: Pick<AccountProfileRow, 'user_id' | 'role' | 'owner_sub_admin_id'>): boolean {
  if (access.isMainAdmin) return true
  return target.role === 'user' && target.owner_sub_admin_id === access.actor.userId
}

export function getScopedProfileFilter(access: AdminAccess) {
  return access.isMainAdmin
    ? null
    : { column: 'owner_sub_admin_id', value: access.actor.userId }
}

async function selectAllProfiles(createQuery: () => any) {
  const rows: any[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await createQuery().range(from, from + pageSize - 1)
    if (error) return { data: null, error }
    const batch = data || []
    rows.push(...batch)
    if (batch.length < pageSize) return { data: rows, error: null }
  }
}

export async function getScopedProfiles(access: AdminAccess): Promise<AccountProfileRow[]> {
  const filter = getScopedProfileFilter(access)
  const { data, error } = await selectAllProfiles(() => {
    let query = access.db
      .from('profiles')
      .select(PROFILE_ENTITLEMENT_SELECT)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
    if (filter) query = query.eq(filter.column, filter.value)
    return query
  })
  if (error) {
    const missingNewEntitlementColumns =
      error.code === '42703' || /account_status|account_expires_at|owner_sub_admin_id|created_by/i.test(error.message || '')

    if (!missingNewEntitlementColumns) throw error

    // Legacy fallback: select older, safe columns and synthesize missing fields
    const { data: legacyData, error: legacyError } = await selectAllProfiles(() => {
      let legacyQuery = access.db
        .from('profiles')
        .select('id, user_id, display_name, avatar_url, role, credits, subscription_tier, created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
      if (filter) legacyQuery = legacyQuery.eq(filter.column, filter.value)
      return legacyQuery
    })
    if (legacyError) throw legacyError

    const rows = (legacyData || []).map((row: any) => ({
      ...row,
      // Ensure newly-introduced columns are present with safe defaults
      role: row.role || 'user',
      credits: typeof row.credits === 'number' ? row.credits : 0,
      // For legacy profiles, default to unlimited to preserve pre-migration behaviour
      unlimited_credits: row.unlimited_credits !== undefined ? Boolean(row.unlimited_credits) : true,
      subscription_tier: row.subscription_tier || 'unlimited',
      account_status: 'active',
      account_expires_at: null,
      owner_sub_admin_id: null,
      created_by: null,
    }))

    return rows as AccountProfileRow[]
  }

  return (data || []) as AccountProfileRow[]
}

export function sanitizeRequestedRole(access: AdminAccess, requestedRole: unknown): AccountRole {
  if (access.isSubAdmin) return 'user'
  return requestedRole === 'admin' || requestedRole === 'sub_admin' ? requestedRole : 'user'
}
