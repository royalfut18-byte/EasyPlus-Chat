import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, CreditCard, Infinity, MessageSquare, ShieldCheck } from 'lucide-react'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'
import { formatEntitlementCredits, getAccountEntitlement } from '@/lib/account-entitlements.server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = await createServiceClient() as any
  const entitlement = await getAccountEntitlement(db, user.id)
  if (!entitlement) redirect('/login')

  const { data: conversations } = await db
    .from('conversations')
    .select('id, title, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(5)

  const { data: allConversations } = await db
    .from('conversations')
    .select('id')
    .eq('user_id', user.id)

  const { data: transactions } = await db
    .from('credit_transactions')
    .select('id, description, amount, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  const conversationIds = (allConversations || []).map((conversation: any) => conversation.id)
  let messageCount = 0
  if (conversationIds.length > 0) {
    const { count } = await db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .in('conversation_id', conversationIds)
    messageCount = count || 0
  }

  const credits = formatEntitlementCredits(entitlement)
  const plan = entitlement.subscriptionTier === 'free' ? 'Free' : 'Premium'

  return (
    <div className="min-h-screen bg-[#0f0f0f] p-4 text-white md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-violet-300">EasyPlus Workspace</p>
            <h1 className="mt-2 text-3xl font-semibold">Dashboard</h1>
            <p className="mt-2 text-sm text-gray-400">Welcome back, {entitlement.displayName || 'User'}.</p>
          </div>
          <Link href="/chat">
            <Button className="rounded-lg bg-violet-600 text-white hover:bg-violet-500">
              <MessageSquare className="mr-2 h-4 w-4" />
              Go to Chat
            </Button>
          </Link>
        </div>

        {entitlement.status === 'expired' && (
          <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
            <h2 className="text-xl font-semibold text-amber-200">Your subscription has ended.</h2>
            <p className="mt-2 text-sm text-amber-100/70">Expired {entitlement.expiresAt ? formatDate(entitlement.expiresAt) : ''}. Contact support or your administrator to renew.</p>
          </section>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard icon={entitlement.unlimitedCredits ? <Infinity /> : <CreditCard />} label="Credits" value={credits} detail={entitlement.unlimitedCredits ? 'Unlimited credits enabled' : 'Finite credits remaining'} />
          <StatCard icon={<MessageSquare />} label="Messages" value={String(messageCount)} detail="Messages across your recent chats" />
          <StatCard icon={<ShieldCheck />} label="Subscription" value={plan} detail={`${entitlement.status} account`} />
        </div>

        <section className="rounded-2xl border border-white/[0.08] bg-[#181818] p-5">
          <h2 className="text-lg font-semibold">Account details</h2>
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <Detail label="Account created" value={formatDate(entitlement.createdAt)} />
            <Detail label="Expiry date" value={entitlement.expiresAt ? formatDate(entitlement.expiresAt) : 'No expiry date'} />
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/[0.08] bg-[#181818] p-5">
            <h2 className="text-lg font-semibold">Recent conversations</h2>
            <div className="mt-4 space-y-2">
              {conversations?.length ? conversations.map((conversation: any) => (
                <Link key={conversation.id} href="/chat" className="block rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.05]">
                  <p className="text-sm text-gray-200">{conversation.title}</p>
                  <p className="mt-1 text-xs text-gray-500">{formatDate(conversation.updated_at)}</p>
                </Link>
              )) : <p className="text-sm text-gray-500">No conversations yet.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.08] bg-[#181818] p-5">
            <h2 className="text-lg font-semibold">Recent credit activity</h2>
            <div className="mt-4 space-y-2">
              {transactions?.length ? transactions.map((transaction: any) => (
                <div key={transaction.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <div>
                    <p className="text-sm text-gray-200">{transaction.description}</p>
                    <p className="mt-1 text-xs text-gray-500">{formatDate(transaction.created_at)}</p>
                  </div>
                  <span className={transaction.amount >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                    {transaction.amount >= 0 ? '+' : ''}{transaction.amount.toLocaleString()}
                  </span>
                </div>
              )) : <p className="text-sm text-gray-500">No credit activity yet.</p>}
            </div>
          </section>
        </div>

        <div className="flex gap-3">
          <Link href="/billing"><Button variant="outline" className="border-white/[0.10] bg-transparent">View billing</Button></Link>
          <Link href="/settings"><Button variant="outline" className="border-white/[0.10] bg-transparent">Account settings</Button></Link>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#181818] p-5">
      <div className="h-5 w-5 text-violet-400">{icon}</div>
      <p className="mt-4 text-sm text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-2 text-xs text-gray-500">{detail}</p>
    </section>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <CalendarDays className="h-4 w-4 text-violet-400" />
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="mt-1 text-gray-200">{value}</p>
      </div>
    </div>
  )
}
