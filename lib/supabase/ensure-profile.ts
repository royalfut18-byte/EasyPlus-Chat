import { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export async function ensureProfile(
  supabase: SupabaseClient<Database>,
  userId: string
) {
  // Check if profile exists
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error && error.code === 'PGRST116') {
    // Profile doesn't exist, create it
    const { data: newProfile, error: insertError } = await supabase
      .from('profiles')
      .insert({
        user_id: userId,
        credits: 1000,
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
