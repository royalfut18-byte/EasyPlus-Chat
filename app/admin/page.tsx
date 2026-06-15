import { redirect } from 'next/navigation'
import { CreditCard, Infinity, MessageSquare, Shield, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess } from '@/lib/admin-access.server'
import { EMPTY_ADMIN_STATISTICS, getAdminStatistics } from '@/lib/admin-statistics.server'
import { AdminUserTable } from '@/components/admin/admin-user-table'
import { BackfillPanel } from '@/components/admin/backfill-panel'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const access = await getAdminAccess(user.id)
  if (!access) redirect('/chat')
  let stats
  let statsError: Error | null = null
  try {
    stats = await getAdminStatistics(access)
  } catch (err: any) {
    console.error('[Admin Page] Failed to load stats:', err)
    statsError = err
    stats = EMPTY_ADMIN_STATISTICS
  }

  return (
    <div className="min-h-screen bg-[#12100e] p-4 text-white md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-clay-300">
            {access.isMainAdmin ? 'EasyPlus Administration' : 'EasyPlus Sub-admin'}
          </p>
          <h1 className="mt-2 text-3xl font-semibold">{access.isMainAdmin ? 'Admin Panel' : 'Your User Panel'}</h1>
          <p className="mt-2 text-sm text-gray-400">
            {access.isMainAdmin ? 'Manage accounts and review trustworthy global totals.' : 'Manage your assigned users and review scoped totals.'}
          </p>
        </div>

        {statsError && (
          <div className="rounded-2xl border border-red-600/20 bg-red-900/10 p-4 text-red-200">
            <div className="font-semibold">Admin stats unavailable. Check server logs.</div>
            <div className="mt-1 text-sm text-red-200">Error: {String(statsError.message || statsError)}</div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={<Users />} label={access.isMainAdmin ? 'Total accounts' : 'Assigned users'} value={(access.isMainAdmin ? stats.totalAccounts : stats.userAccounts).toLocaleString()} />
          {access.isMainAdmin && <Stat icon={<Users />} label="User accounts" value={stats.userAccounts.toLocaleString()} />}
          {access.isMainAdmin && <Stat icon={<Shield />} label="Admin accounts" value={stats.adminAccounts.toLocaleString()} />}
          {access.isMainAdmin && <Stat icon={<Shield />} label="Sub-admins" value={stats.subAdminAccounts.toLocaleString()} />}
          <Stat icon={<Infinity />} label="Unlimited accounts" value={stats.unlimitedAccounts.toLocaleString()} />
          <Stat icon={<CreditCard />} label="Finite credits remaining" value={stats.finiteCreditsRemaining.toLocaleString()} />
          <Stat icon={<MessageSquare />} label="Chats" value={stats.totalChats.toLocaleString()} />
          <Stat icon={<MessageSquare />} label="User prompts" value={stats.userPrompts.toLocaleString()} />
          <Stat icon={<MessageSquare />} label="Total messages" value={stats.totalMessages.toLocaleString()} />
        </div>

        {access.isMainAdmin && <BackfillPanel />}

        <section className="rounded-2xl border border-white/[0.08] bg-[#1b1613] p-4 md:p-5">
          <h2 className="text-lg font-semibold">{access.isMainAdmin ? 'Accounts' : 'Assigned accounts'}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {access.isMainAdmin ? 'Sub-admin groups and unassigned users are managed here.' : 'Only users assigned to your panel are visible.'}
          </p>
          <div className="mt-5"><AdminUserTable /></div>
        </section>
      </div>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#1b1613] p-5">
      <div className="h-5 w-5 text-clay-400">{icon}</div>
      <p className="mt-4 text-xs uppercase tracking-[0.12em] text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </section>
  )
}
