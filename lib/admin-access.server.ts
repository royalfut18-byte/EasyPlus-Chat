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

export async function getScopedProfiles(access: AdminAccess): Promise<AccountProfileRow[]> {
  let query = access.db
    .from('profiles')
    .select(PROFILE_ENTITLEMENT_SELECT)
    .order('created_at', { ascending: false })

  const filter = getScopedProfileFilter(access)
  if (filter) query = query.eq(filter.column, filter.value)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as AccountProfileRow[]
}

export function sanitizeRequestedRole(access: AdminAccess, requestedRole: unknown): AccountRole {
  if (access.isSubAdmin) return 'user'
  return requestedRole === 'admin' || requestedRole === 'sub_admin' ? requestedRole : 'user'
}
