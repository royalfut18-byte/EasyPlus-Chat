export async function ensureProfile(
  supabase: any,
  userId: string
) {
  const db = supabase as any
  // Check if profile exists
  const { data: profile, error } = await db
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error && error.code === 'PGRST116') {
    // Profile doesn't exist, create it
    const { data: newProfile, error: insertError } = await db
      .from('profiles')
      .insert({
        user_id: userId,
        credits: DEFAULT_FINITE_CREDITS,
        subscription_tier: 'free',
        role: 'user',
      })
      .select()
      .single()

    if (insertError) {
      console.error('Failed to create profile:', insertError)
      throw insertError
    }

    return newProfile
  }

  if (error) {
    console.error('Error fetching profile:', error)
    throw error
  }

  return profile
}
import { DEFAULT_FINITE_CREDITS } from '@/lib/account-entitlements'
