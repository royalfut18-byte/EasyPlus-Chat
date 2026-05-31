import { createServiceClient } from '@/lib/supabase/server'
import { getAccountEntitlement } from '@/lib/account-entitlements.server'

export interface ProjectMemoryRow {
  id: string
  project_id: string
  user_id: string
  memory_type?: string | null
  title?: string | null
  content: string
  importance: number
  source_type?: string | null
  source_id?: string | null
  last_used_at?: string | null
  archived_at?: string | null
  created_at: string
  updated_at: string
}

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

export interface ProjectStats {
  chatCount: number
  fileCount: number
  artifactCount: number
  memoryCount: number
}

export interface ProjectWithStats extends ProjectRow {
  stats: ProjectStats
}

function sanitizeProjectUpdates(updates: Partial<ProjectRow>) {
  const clean: Record<string, any> = {}
  if (typeof updates.name === 'string') clean.name = updates.name.trim()
  if ('description' in updates) clean.description = updates.description || null
  if ('instructions' in updates) clean.instructions = updates.instructions || null
  if ('icon' in updates) clean.icon = updates.icon || null
  if ('color' in updates) clean.color = updates.color || null
  if ('archived_at' in updates) clean.archived_at = updates.archived_at || null
  return clean
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
    .is('archived_at', null)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data as ProjectRow[]
}

export async function getProjectsWithStatsForUser(userId: string): Promise<ProjectWithStats[]> {
  const db = await createServiceClient() as any
  const projects = await getProjectsForUser(userId)
  if (projects.length === 0) return []

  const projectIds = projects.map(project => project.id)

  const [
    conversationsResult,
    attachmentsResult,
    memoriesResult,
    artifactsResult,
  ] = await Promise.allSettled([
    db.from('conversations').select('id, project_id').eq('user_id', userId).in('project_id', projectIds),
    db.from('attachments').select('id, project_id').eq('user_id', userId).in('project_id', projectIds),
    db.from('project_memories').select('id, project_id').eq('user_id', userId).in('project_id', projectIds).is('archived_at', null),
    db.from('project_artifacts').select('id, project_id').eq('user_id', userId).in('project_id', projectIds),
  ])

  const stats = new Map<string, ProjectStats>()
  for (const id of projectIds) {
    stats.set(id, { chatCount: 0, fileCount: 0, artifactCount: 0, memoryCount: 0 })
  }

  const addCount = (rows: any[] | null | undefined, key: keyof ProjectStats) => {
    for (const row of rows || []) {
      const projectStats = stats.get(row.project_id)
      if (projectStats) projectStats[key] += 1
    }
  }

  if (conversationsResult.status === 'fulfilled') addCount(conversationsResult.value.data, 'chatCount')
  if (attachmentsResult.status === 'fulfilled') addCount(attachmentsResult.value.data, 'fileCount')
  if (memoriesResult.status === 'fulfilled') addCount(memoriesResult.value.data, 'memoryCount')
  if (artifactsResult.status === 'fulfilled') addCount(artifactsResult.value.data, 'artifactCount')

  return projects.map(project => ({ ...project, stats: stats.get(project.id)! }))
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

export async function getProjectForUser(projectId: string, userId: string) {
  const db = await createServiceClient() as any
  const { data, error } = await db
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', userId)
    .limit(1)
    .single()

  if (error) return null
  return data as ProjectRow
}

export async function updateProject(projectId: string, userId: string, updates: Partial<ProjectRow>) {
  const db = await createServiceClient() as any
  const cleanUpdates = sanitizeProjectUpdates(updates)
  const { data, error } = await db
    .from('projects')
    .update({ ...cleanUpdates, updated_at: new Date().toISOString() })
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

export async function getProjectConversations(projectId: string, userId: string) {
  const db = await createServiceClient() as any
  const { data, error } = await db
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false, nullsFirst: false })

  if (error) throw error
  return data || []
}

export async function getProjectFiles(projectId: string, userId: string) {
  const db = await createServiceClient() as any
  const { data, error } = await db
    .from('attachments')
    .select('id, file_name, file_type, mime_type, storage_path, public_url, processing_status, ocr_status, page_count, created_at, updated_at, important_details, conversation_id, message_id')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    if (error.code === '42P01' || error.code === '42703') return []
    throw error
  }
  return data || []
}

export async function getProjectArtifacts(projectId: string, userId: string) {
  const db = await createServiceClient() as any
  const { data, error } = await db
    .from('project_artifacts')
    .select('id, title, language, explanation, created_at, updated_at, conversation_id, message_id')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })

  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data || []
}

export async function getProjectMemories(projectId: string, userId: string) {
  const db = await createServiceClient() as any
  const { data, error } = await db
    .from('project_memories')
    .select('*')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .is('archived_at', null)
    .order('importance', { ascending: false })
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data || []) as ProjectMemoryRow[]
}

export async function createProjectMemory(
  projectId: string,
  userId: string,
  payload: { title?: string | null; content: string; memory_type?: string | null; importance?: number; source_type?: string | null; source_id?: string | null }
) {
  const db = await createServiceClient() as any
  const content = payload.content.trim()
  if (!content) throw new Error('Memory content is required')

  const { data: existing } = await db
    .from('project_memories')
    .select('id, content')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .is('archived_at', null)
    .ilike('content', `%${content.substring(0, 40)}%`)
    .limit(1)

  if (existing && existing.length > 0) {
    const { data, error } = await db
      .from('project_memories')
      .update({
        title: payload.title?.trim() || null,
        content,
        memory_type: payload.memory_type || 'fact',
        importance: Math.max(1, Math.min(5, Number(payload.importance || 3))),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing[0].id)
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) throw error
    return data as ProjectMemoryRow
  }

  const { data, error } = await db
    .from('project_memories')
    .insert({
      project_id: projectId,
      user_id: userId,
      title: payload.title?.trim() || null,
      content,
      memory_type: payload.memory_type || 'fact',
      importance: Math.max(1, Math.min(5, Number(payload.importance || 3))),
      source_type: payload.source_type || null,
      source_id: payload.source_id || null,
    })
    .select()
    .single()

  if (error) throw error
  return data as ProjectMemoryRow
}

export async function updateProjectMemory(
  projectId: string,
  userId: string,
  memoryId: string,
  updates: { title?: string | null; content?: string; memory_type?: string | null; importance?: number; archived_at?: string | null }
) {
  const db = await createServiceClient() as any
  const clean: Record<string, any> = { updated_at: new Date().toISOString() }
  if ('title' in updates) clean.title = updates.title?.trim() || null
  if ('content' in updates && updates.content) clean.content = updates.content.trim()
  if ('memory_type' in updates) clean.memory_type = updates.memory_type || 'fact'
  if ('importance' in updates) clean.importance = Math.max(1, Math.min(5, Number(updates.importance || 3)))
  if ('archived_at' in updates) clean.archived_at = updates.archived_at

  const { data, error } = await db
    .from('project_memories')
    .update(clean)
    .eq('id', memoryId)
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  return data as ProjectMemoryRow
}

export async function archiveProjectMemory(projectId: string, userId: string, memoryId: string) {
  return updateProjectMemory(projectId, userId, memoryId, { archived_at: new Date().toISOString() })
}

export async function getRelevantProjectContext(projectId: string, userId: string, latestMessage: string) {
  const project = await getProjectForUser(projectId, userId)
  if (!project || project.archived_at) return ''

  const memories = await getProjectMemories(projectId, userId)
  const keywords = latestMessage.toLowerCase().split(/\s+/).filter(word => word.length > 3)
  const scored = memories
    .map(memory => {
      const searchable = `${memory.title || ''} ${memory.content}`.toLowerCase()
      const matches = keywords.filter(keyword => searchable.includes(keyword)).length
      const instructionBoost = ['instruction', 'preference', 'writing_style'].includes(memory.memory_type || '') ? 8 : 0
      return { memory, score: memory.importance * 5 + matches * 12 + instructionBoost }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)

  const lines: string[] = [
    `PROJECT WORKSPACE: ${project.name}`,
  ]

  if (project.description) lines.push(`Project description: ${project.description}`)
  if (project.instructions) {
    lines.push(`Project instructions: ${project.instructions}`)
  }

  if (scored.length > 0) {
    lines.push('Relevant project memory:')
    for (const { memory } of scored) {
      const label = memory.title || memory.memory_type || 'Memory'
      lines.push(`- ${label}: ${memory.content}`)
    }
  }

  return `${lines.join('\n')}\n\nUse project context only when relevant. Project instructions and memories are lower priority than system, safety, and model confidentiality rules.`
}

export async function ensureUserActive(userId: string) {
  const db = await createServiceClient() as any
  const entitlement = await getAccountEntitlement(db, userId)
  if (!entitlement) throw new Error('Profile not found')
  if (entitlement.status !== 'active') throw new Error('Account not active')
}
