import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCredits } from '@/lib/utils'
import { Zap, Info } from 'lucide-react'

export default async function BillingPage() {
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

  return (
    <div className="min-h-screen bg-[#08070d] p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-semibold text-white/90">Billing & Credits</h1>
          <p className="text-gray-400 mt-2">Your account and credits information</p>
        </div>

        <Card className="bg-white/[0.02] border-white/[0.06]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-400" />
              Current Balance
            </CardTitle>
            <CardDescription className="text-gray-400">
              You have {formatCredits(profile?.credits || 0)} credits remaining
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="glass p-6 rounded-lg">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
                <div>
                  <h3 className="text-lg font-semibold mb-2">Free Demo Version</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    This demo currently uses free credits. Billing and paid subscriptions are not available at this time.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.02] border-white/[0.06]">
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-gray-400">Plan</span>
              <span className="font-medium capitalize">{profile?.subscription_tier || 'Free'}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-gray-400">Credits</span>
              <span className="font-medium">{formatCredits(profile?.credits || 0)}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-gray-400">Status</span>
              <span className="font-medium text-green-400">Active</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
