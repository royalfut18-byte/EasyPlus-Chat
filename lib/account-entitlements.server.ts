import { NextResponse } from 'next/server'
export { DEFAULT_FINITE_CREDITS } from '@/lib/account-entitlements'

export type AccountRole = 'user' | 'sub_admin' | 'admin'
export type AccountStatus = 'active' | 'expired' | 'disabled'
export type SubscriptionTier = 'free' | 'pro' | 'unlimited'

export interface AccountProfileRow {
  id?: string
  user_id: string
  display_name?: string | null
  avatar_url?: string | null
  role: AccountRole
  credits: number
  unlimited_credits: boolean
  subscription_tier: SubscriptionTier
  account_status: 'active' | 'disabled'
  account_expires_at: string | null
  owner_sub_admin_id: string | null
  created_by?: string | null
  created_at: string
}

export interface AccountEntitlement {
  userId: string
  displayName: string | null
  avatarUrl: string | null
  role: AccountRole
  credits: number
  unlimitedCredits: boolean
  subscriptionTier: SubscriptionTier
  status: AccountStatus
  expiresAt: string | null
  createdAt: string
  ownerSubAdminId: string | null
  canUsePremiumFeatures: boolean
}

export const PROFILE_ENTITLEMENT_SELECT = [
  'id',
  'user_id',
  'display_name',
  'avatar_url',
  'role',
  'credits',
  'unlimited_credits',
  'subscription_tier',
  'account_status',
  'account_expires_at',
  'owner_sub_admin_id',
  'created_by',
  'created_at',
].join(', ')

export function normalizeEntitlement(profile: AccountProfileRow): AccountEntitlement {
  const expiresAt = profile.account_expires_at || null
  const isExpired = Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now())
  const status: AccountStatus = profile.account_status === 'disabled'
    ? 'disabled'
    : isExpired
      ? 'expired'
      : 'active'
  const unlimitedCredits = profile.role === 'admin' || profile.unlimited_credits === true

  return {
    userId: profile.user_id,
    displayName: profile.display_name || null,
    avatarUrl: profile.avatar_url || null,
    role: profile.role,
    credits: unlimitedCredits ? 0 : Math.max(0, profile.credits || 0),
    unlimitedCredits,
    subscriptionTier: unlimitedCredits ? 'unlimited' : profile.subscription_tier,
    status,
    expiresAt,
    createdAt: profile.created_at,
    ownerSubAdminId: profile.owner_sub_admin_id || null,
    canUsePremiumFeatures: status === 'active',
  }
}

export async function getAccountEntitlement(db: any, userId: string): Promise<AccountEntitlement | null> {
  const { data, error } = await db
    .from('profiles')
    .select(PROFILE_ENTITLEMENT_SELECT)
    .eq('user_id', userId)
    .single()

  if (error) {
    const missingNewEntitlementColumns =
      error.code === '42703' ||
      /account_status|account_expires_at|owner_sub_admin_id|created_by/i.test(error.message || '')

    if (!missingNewEntitlementColumns) return null

    const { data: legacyData, error: legacyError } = await db
      .from('profiles')
      .select('id, user_id, display_name, avatar_url, role, credits, unlimited_credits, subscription_tier, created_at')
      .eq('user_id', userId)
      .single()

    if (legacyError || !legacyData) return null
    return normalizeEntitlement({
      ...legacyData,
      // For legacy rows, treat existing accounts as unlimited by default
      credits: 0,
      unlimited_credits: true,
      subscription_tier: 'unlimited',
      account_status: 'active',
      account_expires_at: null,
      owner_sub_admin_id: null,
      created_by: null,
    } as AccountProfileRow)
  }

  if (!data) return null
  return normalizeEntitlement(data as AccountProfileRow)
}

export function getEntitlementBlockResponse(entitlement: AccountEntitlement | null): NextResponse | null {
  if (!entitlement) {
    return NextResponse.json(
      { error: 'Profile not found. Please contact support.', code: 'PROFILE_NOT_FOUND' },
      { status: 404 }
    )
  }

  if (entitlement.status === 'expired') {
    return NextResponse.json(
      {
        error: 'Your subscription has ended.',
        code: 'ACCOUNT_EXPIRED',
        expiresAt: entitlement.expiresAt,
        supportMessage: 'Contact support or your administrator to renew your account.',
      },
      { status: 403 }
    )
  }

  if (entitlement.status === 'disabled') {
    return NextResponse.json(
      {
        error: 'Your account is disabled.',
        code: 'ACCOUNT_DISABLED',
        supportMessage: 'Contact support or your administrator for assistance.',
      },
      { status: 403 }
    )
  }

  return null
}

export function formatEntitlementCredits(entitlement: AccountEntitlement): string {
  return entitlement.unlimitedCredits
    ? 'Unlimited'
    : new Intl.NumberFormat('en-US').format(entitlement.credits)
}
