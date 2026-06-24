import { redirect } from 'next/navigation'
import { CalendarDays, CreditCard, Infinity, ShieldCheck } from 'lucide-react'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import { formatEntitlementCredits, getAccountEntitlement } from '@/lib/account-entitlements.server'

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = await createServiceClient() as any
  const entitlement = await getAccountEntitlement(db, user.id)
  if (!entitlement) redirect('/login')

  const planLabel = entitlement.subscriptionTier === 'free' ? 'Free' : 'Premium'
  const statusLabel = entitlement.status === 'expired' ? 'Expired' : entitlement.status === 'disabled' ? 'Disabled' : 'Active'
  const creditLabel = formatEntitlementCredits(entitlement)

  return (
    <div className="min-h-screen bg-[#12100e] p-4 text-white md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-clay-300">EasyPlus Account</p>
          <h1 className="mt-2 text-3xl font-semibold">Billing & Credits</h1>
          <p className="mt-2 text-sm text-gray-400">Your current account entitlement and subscription details.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <section className="rounded-2xl border border-white/[0.08] bg-[#1b1613] p-5">
            <CreditCard className="h-5 w-5 text-clay-400" />
            <p className="mt-4 text-sm text-gray-400">Subscription</p>
            <p className="mt-1 text-2xl font-semibold">{planLabel}</p>
            <p className="mt-2 text-xs text-gray-500">{entitlement.subscriptionTier === 'free' ? 'Standard account' : 'Premium subscription'}</p>
          </section>

          <section className="rounded-2xl border border-white/[0.08] bg-[#1b1613] p-5">
            {entitlement.unlimitedCredits ? <Infinity className="h-5 w-5 text-clay-400" /> : <CreditCard className="h-5 w-5 text-clay-400" />}
            <p className="mt-4 text-sm text-gray-400">Credits</p>
            <p className="mt-1 text-2xl font-semibold">{creditLabel}</p>
            <p className="mt-2 text-xs text-gray-500">{entitlement.unlimitedCredits ? 'Unlimited credits enabled' : 'Finite credits remaining'}</p>
          </section>

          <section className="rounded-2xl border border-white/[0.08] bg-[#1b1613] p-5">
            <ShieldCheck className="h-5 w-5 text-clay-400" />
            <p className="mt-4 text-sm text-gray-400">Account status</p>
            <p className={`mt-1 text-2xl font-semibold ${entitlement.status === 'active' ? 'text-emerald-300' : 'text-amber-300'}`}>{statusLabel}</p>
            <p className="mt-2 text-xs text-gray-500">Server-verified entitlement</p>
          </section>
        </div>

        {entitlement.status === 'expired' && (
          <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
            <h2 className="text-xl font-semibold text-amber-200">Your subscription has ended.</h2>
            <p className="mt-2 text-sm text-amber-100/70">Contact support or your administrator to renew your account.</p>
          </section>
        )}

        <section className="rounded-2xl border border-white/[0.08] bg-[#1b1613] p-5">
          <h2 className="text-lg font-semibold">Account details</h2>
          <div className="mt-4 divide-y divide-white/[0.06] text-sm">
            <Detail label="Plan" value={`${planLabel} subscription`} />
            <Detail label="Credits" value={entitlement.unlimitedCredits ? 'Unlimited' : creditLabel} />
            <Detail label="Created" value={formatDate(entitlement.createdAt)} icon={<CalendarDays className="h-4 w-4" />} />
            <Detail label="Expiry" value={entitlement.expiresAt ? formatDate(entitlement.expiresAt) : 'No expiry date'} />
            <Detail label="Status" value={statusLabel} />
          </div>
        </section>
      </div>
    </div>
  )
}

function Detail({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-gray-500">{label}</span>
      <span className="flex items-center gap-2 text-right text-gray-200">{icon}{value}</span>
    </div>
  )
}
