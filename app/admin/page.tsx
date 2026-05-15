import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AdminUserTable } from '@/components/admin/admin-user-table'
import { BackfillPanel } from '@/components/admin/backfill-panel'
import { Users, CreditCard, TrendingUp } from 'lucide-react'

export default async function AdminPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if ((profile as any)?.role !== 'admin') {
    redirect('/chat')
  }

  const { count: userCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })

  const { data: totalCredits } = await supabase
    .from('profiles')
    .select('credits')

  const totalCreditsSum = totalCredits?.reduce((sum, p: any) => sum + p.credits, 0) || 0

  const { count: messageCount } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })

  return (
    <div className="min-h-screen bg-[#08070d] p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-semibold text-white/90">Admin Panel</h1>
          <p className="text-gray-500 mt-2">Manage users and monitor platform usage</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-white/[0.02] border-white/[0.06]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">
                Total Users
              </CardTitle>
              <Users className="h-4 w-4 text-blue-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{userCount || 0}</div>
            </CardContent>
          </Card>

          <Card className="bg-white/[0.02] border-white/[0.06]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">
                Total Credits
              </CardTitle>
              <CreditCard className="h-4 w-4 text-yellow-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">
                {totalCreditsSum.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/[0.02] border-white/[0.06]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">
                Total Messages
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-green-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{messageCount || 0}</div>
            </CardContent>
          </Card>
        </div>

        <BackfillPanel />

        <Card className="bg-white/[0.02] border-white/[0.06]">
          <CardHeader>
            <CardTitle>All Users</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminUserTable />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
