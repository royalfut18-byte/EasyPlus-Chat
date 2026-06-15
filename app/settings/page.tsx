import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Brain, CalendarDays, CreditCard, Infinity } from 'lucide-react'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import { formatEntitlementCredits, getAccountEntitlement } from '@/lib/account-entitlements.server'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = await createServiceClient() as any
  const entitlement = await getAccountEntitlement(db, user.id)
  if (!entitlement) redirect('/login')

  return (
    <div className="min-h-screen bg-[#12100e] p-4 text-white md:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/chat" className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2 transition-colors hover:bg-white/[0.06]">
            <ArrowLeft className="h-5 w-5 text-gray-400" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">Settings</h1>
            <p className="mt-1 text-sm text-gray-500">Account details and workspace preferences.</p>
          </div>
        </div>

        <section className="rounded-2xl border border-white/[0.08] bg-[#1b1613] p-5">
          <h2 className="text-lg font-semibold">Account</h2>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Detail icon={entitlement.unlimitedCredits ? <Infinity /> : <CreditCard />} label="Credits" value={entitlement.unlimitedCredits ? 'Unlimited credits' : `${formatEntitlementCredits(entitlement)} credits`} />
            <Detail icon={<CalendarDays />} label="Created" value={formatDate(entitlement.createdAt)} />
            <Detail icon={<CalendarDays />} label="Expiry" value={entitlement.expiresAt ? formatDate(entitlement.expiresAt) : 'No expiry date'} />
            <Detail icon={<CreditCard />} label="Subscription" value={entitlement.subscriptionTier === 'free' ? 'Free' : 'Premium'} />
          </div>
        </section>

        <Link href="/settings/memory" className="group block rounded-2xl border border-white/[0.08] bg-[#1b1613] p-5 transition-colors hover:bg-[#202020]">
          <div className="flex items-center gap-4">
            <div className="rounded-xl border border-clay-500/20 bg-clay-500/10 p-2.5"><Brain className="h-5 w-5 text-clay-400" /></div>
            <div>
              <h3 className="font-medium transition-colors group-hover:text-clay-300">Memory</h3>
              <p className="mt-1 text-sm text-gray-500">View and manage what EasyPlus remembers about you.</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <span className="h-4 w-4 text-clay-400">{icon}</span>
      <div><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-gray-200">{value}</p></div>
    </div>
  )
}
