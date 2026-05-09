import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      // Use service role client to bypass RLS for profile creation
      const serviceClient = await createServiceClient()
      const db = serviceClient as any

      const { data: existingProfile } = await db
        .from('profiles')
        .select('id')
        .eq('user_id', data.user.id)
        .single()

      if (!existingProfile) {
        console.log('Creating profile for new user:', data.user.id)

        const { error: profileError } = await db.from('profiles').insert({
          user_id: data.user.id,
          display_name: data.user.user_metadata.full_name || data.user.email?.split('@')[0],
          avatar_url: data.user.user_metadata.avatar_url,
          credits: 1000,
          subscription_tier: 'free',
          role: 'user',
        })

        if (profileError) {
          console.error('Failed to create profile:', profileError)
        }

        const { error: subError } = await db.from('subscriptions').insert({
          user_id: data.user.id,
          stripe_customer_id: '',
          tier: 'free',
          status: 'active',
        })

        if (subError) {
          console.error('Failed to create subscription:', subError)
        }

        const { error: txError } = await db.from('credit_transactions').insert({
          user_id: data.user.id,
          amount: 1000,
          type: 'grant',
          description: 'Welcome bonus',
        })

        if (txError) {
          console.error('Failed to create transaction:', txError)
        }
      }

      return NextResponse.redirect(new URL('/chat', request.url))
    }
  }

  return NextResponse.redirect(new URL('/login', request.url))
}
