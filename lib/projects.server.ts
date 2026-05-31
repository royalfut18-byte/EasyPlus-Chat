import { createServiceClient } from '@/lib/supabase/server'
import { getAccountEntitlement } from '@/lib/account-entitlements.server'

export interface ProjectRow {
  id: string
  user_id: string
  name: string
  description?: string | null
  instructions?: string | null
  icon?: string | null
  color?: string | null
  archived_at?: string | null
  created_at: string
  updated_at: string
}

export async function createProjectForUser(userId: string, payload: { name: string; description?: string; instructions?: string }) {
  const db = await createServiceClient() as any
  const { data, error } = await db
    .from('projects')
    .insert({ user_id: userId, name: payload.name, description: payload.description || null, instructions: payload.instructions || null })
    .select()
    .single()

  if (error) throw error
  return data as ProjectRow
}

export async function getProjectsForUser(userId: string) {
  const db = await createServiceClient() as any
  const { data, error } = await db
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data as ProjectRow[]
}

export async function getProjectById(projectId: string) {
  const db = await createServiceClient() as any
  const { data, error } = await db
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .limit(1)
    .single()

  if (error) throw error
  return data as ProjectRow | null
}

export async function updateProject(projectId: string, userId: string, updates: Partial<ProjectRow>) {
  const db = await createServiceClient() as any
  const { data, error } = await db
    .from('projects')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  return data as ProjectRow
}

export async function archiveProject(projectId: string, userId: string) {
  return updateProject(projectId, userId, { archived_at: new Date().toISOString() } as any)
}

export async function ensureUserActive(userId: string) {
  const db = await createServiceClient() as any
  const entitlement = await getAccountEntitlement(db, userId)
  if (!entitlement) throw new Error('Profile not found')
  if (entitlement.status !== 'active') throw new Error('Account not active')
}
