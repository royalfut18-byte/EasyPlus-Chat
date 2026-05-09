import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CreditCard, MessageSquare, TrendingUp, Zap } from 'lucide-react'
import Link from 'next/link'
import { formatCredits, formatDate } from '@/lib/utils'

export default async function DashboardPage() {
  const supabase = await createClient()
  const db = supabase as any
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await db
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  const { data: conversations } = await db
    .from('conversations')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(5)

  const { data: transactions } = await db
    .from('credit_transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  const { count: messageCount } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'user')

  return (
    <div className="min-h-screen bg-[#0A0A0F] p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold gradient-text">Dashboard</h1>
            <p className="text-gray-400 mt-2">Welcome back, {profile?.display_name}</p>
          </div>
          <Link href="/chat">
            <Button className="gradient-primary">
              <MessageSquare className="mr-2 h-4 w-4" />
              Go to Chat
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="glass-strong border-white/10">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">
                Credit Balance
              </CardTitle>
              <Zap className="h-4 w-4 text-yellow-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold gradient-text">
                {formatCredits(profile?.credits || 0)}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {profile?.subscription_tier.toUpperCase()} Plan
              </p>
            </CardContent>
          </Card>

          <Card className="glass-strong border-white/10">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">
                Messages Sent
              </CardTitle>
              <MessageSquare className="h-4 w-4 text-blue-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{messageCount || 0}</div>
              <p className="text-xs text-gray-500 mt-2">Total conversations</p>
            </CardContent>
          </Card>

          <Card className="glass-strong border-white/10">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">
                Subscription
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-green-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white capitalize">
                {profile?.subscription_tier}
              </div>
              <Link href="/billing">
                <Button variant="link" className="p-0 h-auto text-xs mt-2">
                  View credits
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="glass-strong border-white/10">
            <CardHeader>
              <CardTitle>Recent Conversations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {conversations && conversations.length > 0 ? (
                  conversations.map((conv: any) => (
                    <Link key={conv.id} href="/chat">
                      <div className="glass p-3 rounded-lg hover:bg-white/10 transition-colors">
                        <p className="font-medium text-white">{conv.title}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatDate(conv.updated_at)}
                        </p>
                      </div>
                    </Link>
                  ))
                ) : (
                  <p className="text-gray-500 text-sm">No conversations yet</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="glass-strong border-white/10">
            <CardHeader>
              <CardTitle>Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {transactions && transactions.length > 0 ? (
                  transactions.map((tx: any) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between glass p-3 rounded-lg"
                    >
                      <div>
                        <p className="text-sm text-white">{tx.description}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {formatDate(tx.created_at)}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-medium ${
                          tx.amount > 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {tx.amount > 0 ? '+' : ''}
                        {formatCredits(tx.amount)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-sm">No transactions yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="glass-strong border-white/10">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <Link href="/billing">
              <Button className="gradient-primary">
                <CreditCard className="mr-2 h-4 w-4" />
                View Credits
              </Button>
            </Link>
            <Link href="/chat">
              <Button variant="outline">Start New Chat</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
