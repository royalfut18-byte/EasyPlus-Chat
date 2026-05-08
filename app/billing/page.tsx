import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'
import { BillingActions } from '@/components/billing/billing-actions'
import { formatCredits, formatCurrency } from '@/lib/utils'
import { SUBSCRIPTION_TIERS, CREDIT_TOP_UPS } from '@/lib/stripe'

export default async function BillingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return (
    <div className="min-h-screen bg-[#0A0A0F] p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-bold gradient-text">Billing & Credits</h1>
          <p className="text-gray-400 mt-2">Manage your subscription and top up credits</p>
        </div>

        <Card className="glass-strong border-white/10">
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
            <CardDescription className="text-gray-400">
              You are currently on the {profile?.subscription_tier.toUpperCase()} plan with{' '}
              {formatCredits(profile?.credits || 0)} credits remaining
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BillingActions />
          </CardContent>
        </Card>

        <div>
          <h2 className="text-2xl font-bold mb-6">Subscription Plans</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {Object.entries(SUBSCRIPTION_TIERS).map(([tier, data]) => (
              <Card
                key={tier}
                className={`glass-strong border-white/10 ${
                  profile?.subscription_tier === tier ? 'glow-border' : ''
                }`}
              >
                <CardHeader>
                  <CardTitle className="capitalize">{data.name}</CardTitle>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">
                      {formatCurrency(data.price)}
                    </span>
                    <span className="text-gray-400">/month</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-400" />
                      <span className="text-sm">
                        {formatCredits(data.credits)} credits/month
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-400" />
                      <span className="text-sm">All AI models</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-400" />
                      <span className="text-sm">Priority support</span>
                    </div>
                  </div>
                  {profile?.subscription_tier === tier ? (
                    <Button disabled className="w-full">
                      Current Plan
                    </Button>
                  ) : (
                    <Button className="w-full gradient-primary" disabled={!data.priceId}>
                      {data.priceId ? 'Upgrade' : 'Coming Soon'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-bold mb-6">One-Time Credit Top-Ups</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {CREDIT_TOP_UPS.map((topup) => (
              <Card key={topup.credits} className="glass-strong border-white/10">
                <CardHeader>
                  <CardTitle>{formatCredits(topup.credits)} Credits</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">
                      {formatCurrency(topup.price)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button className="w-full gradient-primary" disabled={!topup.priceId}>
                    {topup.priceId ? 'Purchase' : 'Coming Soon'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
