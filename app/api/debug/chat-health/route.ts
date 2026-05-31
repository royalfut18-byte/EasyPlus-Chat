import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  const checks: Record<string, any> = {
    timestamp: new Date().toISOString(),
    runtime: 'nodejs',
  }

  // Env checks (no secrets exposed)
  checks.inferenceConfigured = !!process.env.AWS_BEARER_TOKEN_BEDROCK
  checks.searchConfigured = !!process.env.TAVILY_API_KEY
  checks.hasSupabaseUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL
  checks.hasSupabaseAnonKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Auth check
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    checks.userFound = !!user
    checks.authError = error?.message || null
    checks.userId = user?.id?.substring(0, 8) || null

    if (user) {
      const { data: profile, error: profileError } = await (supabase as any)
        .from('profiles')
        .select('credits, role, unlimited_credits')
        .eq('user_id', user.id)
        .single()

      checks.profileFound = !!profile
      checks.profileError = profileError?.message || null
      if (profile) {
        checks.credits = profile.credits
        checks.role = profile.role
        checks.unlimitedCredits = profile.unlimited_credits
      }
    }
  } catch (e: any) {
    checks.supabaseError = e.message
  }

  // Node version
  checks.nodeVersion = process.version

  checks.ok = checks.inferenceConfigured && checks.hasSupabaseUrl && checks.userFound && checks.profileFound

  return NextResponse.json(checks, { status: checks.ok ? 200 : 500 })
}
