import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { stripe, SUBSCRIPTION_TIERS, CREDIT_TOP_UPS } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const headersList = await headers()
  const signature = headersList.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (error: any) {
    console.error('Webhook signature verification failed:', error.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.user_id

        if (!userId) break

        if (session.mode === 'subscription') {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          )
          const priceId = subscription.items.data[0].price.id

          const tier = Object.entries(SUBSCRIPTION_TIERS).find(
            ([_, data]) => data.priceId === priceId
          )?.[0] as 'free' | 'pro' | 'unlimited' | undefined

          if (tier) {
            await supabase
              .from('subscriptions')
              .update({
                stripe_subscription_id: subscription.id,
                tier,
                status: 'active',
                current_period_end: new Date(
                  subscription.current_period_end * 1000
                ).toISOString(),
              })
              .eq('user_id', userId)

            await supabase
              .from('profiles')
              .update({
                subscription_tier: tier,
                credits: SUBSCRIPTION_TIERS[tier].credits,
              })
              .eq('user_id', userId)

            await supabase.from('credit_transactions').insert({
              user_id: userId,
              amount: SUBSCRIPTION_TIERS[tier].credits,
              type: 'grant',
              description: `${tier} subscription activated`,
            })
          }
        } else if (session.mode === 'payment') {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id)
          const priceId = lineItems.data[0]?.price?.id

          const topUp = CREDIT_TOP_UPS.find((t) => t.priceId === priceId)

          if (topUp) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('credits')
              .eq('user_id', userId)
              .single()

            if (profile) {
              await supabase
                .from('profiles')
                .update({ credits: profile.credits + topUp.credits })
                .eq('user_id', userId)

              await supabase.from('credit_transactions').insert({
                user_id: userId,
                amount: topUp.credits,
                type: 'top_up',
                description: `Credit top-up: ${topUp.credits} credits`,
              })
            }
          }
        }
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', subscription.id)
          .single()

        if (sub) {
          await supabase
            .from('subscriptions')
            .update({
              status: subscription.status as any,
              current_period_end: new Date(
                subscription.current_period_end * 1000
              ).toISOString(),
            })
            .eq('stripe_subscription_id', subscription.id)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', subscription.id)
          .single()

        if (sub) {
          await supabase
            .from('subscriptions')
            .update({ tier: 'free', status: 'canceled' })
            .eq('stripe_subscription_id', subscription.id)

          await supabase
            .from('profiles')
            .update({
              subscription_tier: 'free',
              credits: SUBSCRIPTION_TIERS.free.credits,
            })
            .eq('user_id', sub.user_id)
        }
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Webhook handler error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
