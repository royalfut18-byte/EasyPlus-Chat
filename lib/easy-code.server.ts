import 'server-only'

import JSZip from 'jszip'
import { createServiceClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { readServerEnv } from '@/lib/server-env'

export const EASY_CODE_MAX_PROMPT_LENGTH = 4000
export const EASY_CODE_MAX_FILES_PER_AI_CALL = 28
export const EASY_CODE_MAX_FILE_BYTES = 220_000
export const EASY_CODE_MAX_PROJECT_FILES = 120
export const EASY_CODE_MAX_ZIP_BYTES = 12 * 1024 * 1024
const EASY_CODE_DEEPSEEK_TIMEOUT_MS = 55_000
const EASY_CODE_REPAIR_TIMEOUT_MS = 30_000

export type EasyCodeOperation = 'create' | 'update' | 'delete' | 'rename'

export interface EasyCodeProject {
  id: string
  user_id: string
  title: string
  description: string | null
  framework: string | null
  status: string
  generation_status?: 'idle' | 'generating' | 'ready' | 'failed' | 'incomplete'
  generation_phase?: string | null
  generation_error?: string | null
  generation_metadata?: any
  last_generated_at?: string | null
  created_at: string
  updated_at: string
}

export interface EasyCodeProjectSummary extends EasyCodeProject {
  file_count: number
  meaningful_file_count: number
  is_download_ready: boolean
}

export interface EasyCodeFile {
  id: string
  project_id: string
  user_id: string
  path: string
  language: string | null
  content: string
  size_bytes: number
  created_at: string
  updated_at: string
}

export interface EasyCodeMessage {
  id: string
  project_id: string
  user_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata: any
  created_at: string
}

export interface EasyCodeAiFile {
  path: string
  language?: string | null
  content?: string
  operation: EasyCodeOperation
  newPath?: string
}

export interface EasyCodeAiResult {
  summary: string
  files: EasyCodeAiFile[]
  instructions: string[]
  previewType: 'static-html' | 'unsupported'
  title?: string
  framework?: string
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  html: 'html',
  css: 'css',
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  md: 'markdown',
  py: 'python',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  txt: 'text',
}

function getDb() {
  return createServiceClient() as Promise<any>
}

const EASY_CODE_IDEMPOTENCY_MIGRATION_ERROR =
  'Easy Code database update required. Apply the client_request_id migration and reload the Supabase schema cache.'

function isEasyCodeIdempotencySchemaError(error: any): boolean {
  const detail = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return detail.includes('client_request_id') && (
    detail.includes('schema cache') ||
    detail.includes('does not exist') ||
    detail.includes('could not find')
  )
}

function throwIfEasyCodeIdempotencySchemaError(error: any) {
  if (!isEasyCodeIdempotencySchemaError(error)) return
  console.error('[Easy Code] Idempotency schema migration required', {
    code: error?.code || null,
    phase: 'client_request_id_schema_check',
  })
  throw new Error(EASY_CODE_IDEMPOTENCY_MIGRATION_ERROR)
}

function isTimeoutError(error: any): boolean {
  return error?.name === 'AbortError' ||
    error?.name === 'TimeoutError' ||
    /aborted|timeout|timed out/i.test(error?.message || '')
}

function getSafeEasyCodeError(error: any): string {
  if (isTimeoutError(error)) return 'Easy Code generation timed out. Retry generation.'
  return typeof error?.message === 'string' && error.message
    ? error.message
    : 'Project was created but generation failed.'
}

function isStaticLandingPageRequest(input: string): boolean {
  const text = input.toLowerCase()
  const asksForOtherStack = /\b(react|next\.?js|vite|typescript|node|express|python|flask|fastapi|vue|svelte|angular)\b/.test(text)
  return !asksForOtherStack && /\b(landing page|website|web site|webpage|homepage|portfolio|business|carwash|car wash|detailing)\b/.test(text)
}

function getMissingStaticStarterFiles(files: Array<Pick<EasyCodeFile, 'path'> | Pick<EasyCodeAiFile, 'path' | 'newPath'>>): string[] {
  const paths = new Set(files.map((file: any) => (file.newPath || file.path || '').toLowerCase()))
  return ['index.html', 'styles.css', 'script.js', 'README.md'].filter(path => !paths.has(path.toLowerCase()))
}

export function sanitizeEasyCodePrompt(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.replace(/\s+/g, ' ').trim().slice(0, EASY_CODE_MAX_PROMPT_LENGTH)
}

export function bytesOf(text: string): number {
  return Buffer.byteLength(text || '', 'utf8')
}

export function inferLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return LANGUAGE_BY_EXT[ext] || 'text'
}

export function slugFileName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'easy-code-project'
}

export function validateEasyCodePath(path: unknown): string {
  if (typeof path !== 'string') throw new Error('Invalid file path.')
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!clean || clean.length > 180) throw new Error('Invalid file path.')
  if (
    clean.startsWith('../') ||
    clean.includes('/../') ||
    clean === '..' ||
    clean.includes('\0') ||
    /^[a-zA-Z]:/.test(clean)
  ) {
    throw new Error('Invalid file path.')
  }
  return clean
}

export function normalizeAiResult(raw: any): EasyCodeAiResult {
  const files = Array.isArray(raw?.files) ? raw.files : []
  const cleanFiles = files.slice(0, EASY_CODE_MAX_FILES_PER_AI_CALL).map((file: any) => {
    const operation = ['create', 'update', 'delete', 'rename'].includes(file?.operation)
      ? file.operation as EasyCodeOperation
      : 'update'
    const path = validateEasyCodePath(file?.path)
    const content = typeof file?.content === 'string' ? file.content : ''
    if (content && bytesOf(content) > EASY_CODE_MAX_FILE_BYTES) {
      throw new Error(`File is too large: ${path}`)
    }
    return {
      path,
      language: typeof file?.language === 'string' ? file.language.slice(0, 40) : inferLanguage(path),
      content,
      operation,
      newPath: file?.newPath ? validateEasyCodePath(file.newPath) : undefined,
    }
  })

  return {
    summary: typeof raw?.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim().slice(0, 2000)
      : 'Updated the Easy Code project.',
    files: cleanFiles,
    instructions: Array.isArray(raw?.instructions)
      ? raw.instructions.filter((item: unknown) => typeof item === 'string').slice(0, 10)
      : [],
    previewType: raw?.previewType === 'static-html' ? 'static-html' : 'unsupported',
    title: typeof raw?.title === 'string' ? raw.title.trim().slice(0, 80) : undefined,
    framework: typeof raw?.framework === 'string' ? raw.framework.trim().slice(0, 80) : undefined,
  }
}

export function getEasyCodeReadiness(
  files: Array<Pick<EasyCodeFile, 'path'> & Partial<Pick<EasyCodeFile, 'content' | 'size_bytes'>>>,
  project?: Pick<EasyCodeProject, 'description' | 'framework'> | null
) {
  const meaningfulFiles = files.filter(file => {
    const path = file.path.toLowerCase()
    const hasContent = typeof file.content === 'string'
      ? file.content.trim().length > 0
      : Number(file.size_bytes || 0) > 0
    return path !== 'readme.md' && hasContent
  })
  const expectsStaticWebsite = project?.framework === 'html' ||
    /\b(landing page|website|web site|webpage|portfolio|product page)\b/i.test(project?.description || '')
  const hasIndexHtml = files.some(file => file.path.toLowerCase() === 'index.html' && (
    typeof file.content === 'string' ? file.content.trim().length > 0 : Number(file.size_bytes || 0) > 0
  ))
  return {
    ready: meaningfulFiles.length >= 2 && (!expectsStaticWebsite || hasIndexHtml),
    fileCount: files.length,
    meaningfulFileCount: meaningfulFiles.length,
    hasIndexHtml,
    expectsStaticWebsite,
  }
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  if (fenced) return fenced.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  throw new Error('The AI returned invalid file data. Try again.')
}

async function callAzureDeepSeekJson(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  maxTokens = 8192,
  options: { timeoutMs?: number; phase?: string; projectId?: string } = {}
): Promise<string> {
  const apiKey = readServerEnv('AZURE_DEEPSEEK_API_KEY')
  const baseUrl = readServerEnv('AZURE_DEEPSEEK_BASE_URL')?.replace(/\/+$/, '')
  const model = readServerEnv('AZURE_DEEPSEEK_MODEL') || 'DeepSeek-V4-Pro'

  if (!apiKey || !baseUrl) {
    console.error('[Easy Code] Missing DeepSeek configuration', {
      apiKeyConfigured: Boolean(apiKey),
      baseUrlConfigured: Boolean(baseUrl),
      modelConfigured: Boolean(model),
    })
    throw new Error('Could not generate files.')
  }
  const safeApiKey = apiKey

  const requestBody = {
    model,
    messages,
    temperature: 0.25,
    max_tokens: maxTokens,
    stream: false,
    response_format: { type: 'json_object' },
  }

  const timeoutMs = options.timeoutMs || EASY_CODE_DEEPSEEK_TIMEOUT_MS
  const startedAt = Date.now()
  console.info('[Easy Code] DeepSeek request started', {
    projectId: options.projectId || null,
    phase: options.phase || 'deepseek_generation',
    maxTokens,
    timeoutMs,
  })

  async function request(authMode: 'api-key' | 'bearer') {
    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authMode === 'api-key' ? { 'api-key': safeApiKey } : { Authorization: `Bearer ${safeApiKey}` }),
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  let response: Response
  try {
    response = await request('api-key')
  } catch (error: any) {
    console.error('[Easy Code] DeepSeek request timed out or failed before response', {
      projectId: options.projectId || null,
      phase: options.phase || 'deepseek_generation',
      timeoutHit: isTimeoutError(error),
      durationMs: Date.now() - startedAt,
    })
    throw error
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => {})
    try {
      response = await request('bearer')
    } catch (error: any) {
      console.error('[Easy Code] DeepSeek fallback request timed out or failed before response', {
        projectId: options.projectId || null,
        phase: options.phase || 'deepseek_generation',
        timeoutHit: isTimeoutError(error),
        durationMs: Date.now() - startedAt,
      })
      throw error
    }
  }

  if (!response.ok) {
    console.error('[Easy Code] DeepSeek request failed', {
      status: response.status,
      projectId: options.projectId || null,
      phase: options.phase || 'deepseek_generation',
      durationMs: Date.now() - startedAt,
    })
    throw new Error(response.status === 429 ? 'Could not generate files. Please try again in a moment.' : 'Could not generate files.')
  }

  const data = await response.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    console.error('[Easy Code] DeepSeek returned empty content', {
      projectId: options.projectId || null,
      phase: options.phase || 'deepseek_generation',
      durationMs: Date.now() - startedAt,
    })
    throw new Error('The AI returned invalid file data. Try again.')
  }
  console.info('[Easy Code] DeepSeek request ended', {
    projectId: options.projectId || null,
    phase: options.phase || 'deepseek_generation',
    durationMs: Date.now() - startedAt,
    responseChars: content.length,
  })
  return content
}

async function parseEasyCodeJson(text: string, projectId?: string): Promise<EasyCodeAiResult> {
  try {
    const result = normalizeAiResult(JSON.parse(extractJson(text)))
    console.info('[Easy Code] JSON parse succeeded', { projectId: projectId || null, fileCount: result.files.length })
    return result
  } catch (parseError: any) {
    console.warn('[Easy Code] JSON parse failed, attempting one repair pass', {
      projectId: projectId || null,
      message: parseError?.message,
    })
    const repaired = await callAzureDeepSeekJson([
      {
        role: 'system',
        content: 'Return only valid JSON matching this schema: {"summary":string,"files":[{"path":string,"language":string,"content":string,"operation":"create|update|delete|rename","newPath":string}],"instructions":string[],"previewType":"static-html|unsupported","title":string,"framework":string}. Do not include markdown.',
      },
      { role: 'user', content: `Repair this invalid Easy Code response into valid JSON only:\n${text.slice(0, 20000)}` },
    ], 4096, { timeoutMs: EASY_CODE_REPAIR_TIMEOUT_MS, phase: 'json_repair', projectId })
    try {
      const result = normalizeAiResult(JSON.parse(extractJson(repaired)))
      console.info('[Easy Code] JSON repair succeeded', { projectId: projectId || null, fileCount: result.files.length })
      return result
    } catch (repairError: any) {
      console.error('[Easy Code] JSON repair failed', {
        projectId: projectId || null,
        message: repairError?.message,
      })
      throw repairError
    }
  }
}

export async function requireEasyCodeUser(userId: string) {
  const db = await getDb()
  const block = getEntitlementBlockResponse(await getAccountEntitlement(db, userId))
  if (block) return block
  return null
}

export async function listEasyCodeProjects(userId: string): Promise<EasyCodeProjectSummary[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('easy_code_projects')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
  if (error) throw error
  const projects = data || []
  if (projects.length === 0) return []
  const { data: fileRows, error: fileError } = await db
    .from('easy_code_files')
    .select('project_id,path,size_bytes')
    .eq('user_id', userId)
    .in('project_id', projects.map((project: EasyCodeProject) => project.id))
  if (fileError) throw fileError
  const filesByProject = new Map<string, Array<{ path: string; size_bytes: number }>>()
  for (const file of fileRows || []) {
    const current = filesByProject.get(file.project_id) || []
    current.push(file)
    filesByProject.set(file.project_id, current)
  }
  return projects.map((project: EasyCodeProject) => {
    const readiness = getEasyCodeReadiness(filesByProject.get(project.id) || [], project)
    return {
      ...project,
      file_count: readiness.fileCount,
      meaningful_file_count: readiness.meaningfulFileCount,
      is_download_ready: project.generation_status === 'ready' && readiness.ready,
    }
  })
}

export async function getEasyCodeProject(userId: string, projectId: string): Promise<EasyCodeProject | null> {
  const db = await getDb()
  const { data, error } = await db
    .from('easy_code_projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', userId)
    .limit(1)
    .single()
  if (error) return null
  return data
}

export async function getEasyCodeFiles(userId: string, projectId: string): Promise<EasyCodeFile[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('easy_code_files')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .order('path', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getEasyCodeMessages(userId: string, projectId: string): Promise<EasyCodeMessage[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('easy_code_messages')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(80)
  if (error) throw error
  return data || []
}

export function buildEasyCodeProgress(phase: string, filesCreated: string[] = [], error?: string | null) {
  const order = ['creating_project', 'planning', 'generating_files', 'saving_files', 'building_preview', 'complete']
  const currentIndex = order.indexOf(phase)
  const stateFor = (step: string) => {
    if (phase === 'failed') return 'pending'
    const stepIndex = order.indexOf(step)
    if (currentIndex > stepIndex) return 'done'
    if (currentIndex === stepIndex) return 'active'
    return 'pending'
  }
  return {
    progress: [
      { label: 'Project created', state: phase === 'creating_project' ? 'active' : 'done' },
      { label: 'Planning file structure', state: stateFor('planning') },
      { label: 'Writing files', state: stateFor('generating_files') },
      { label: 'Saving files', state: stateFor('saving_files') },
      { label: 'Preparing preview', state: stateFor('building_preview') },
      { label: 'Ready to download', state: phase === 'complete' ? 'done' : 'pending' },
    ],
    filesCreated,
    lastError: error || null,
  }
}

async function updateEasyCodeGenerationState(
  userId: string,
  projectId: string,
  updates: {
    status?: 'idle' | 'generating' | 'ready' | 'failed' | 'incomplete'
    phase?: string | null
    error?: string | null
    metadata?: any
    title?: string | null
    framework?: string | null
    lastGeneratedAt?: string | null
  }
) {
  const db = await getDb()
  const payload: Record<string, any> = { updated_at: new Date().toISOString() }
  if (updates.status) payload.generation_status = updates.status
  if ('phase' in updates) payload.generation_phase = updates.phase
  if ('error' in updates) payload.generation_error = updates.error
  if ('metadata' in updates) payload.generation_metadata = updates.metadata || {}
  if ('title' in updates && updates.title) payload.title = updates.title
  if ('framework' in updates) payload.framework = updates.framework
  if ('lastGeneratedAt' in updates) payload.last_generated_at = updates.lastGeneratedAt
  const { error } = await db.from('easy_code_projects').update(payload).eq('id', projectId).eq('user_id', userId)
  if (error) throw error
}

export async function createEasyCodeProjectShell(userId: string, prompt: string, clientRequestId?: string | null) {
  const db = await getDb()
  const cleanPrompt = sanitizeEasyCodePrompt(prompt)
  if (cleanPrompt.length < 5) throw new Error('Describe what you want to build.')
  const cleanClientRequestId = typeof clientRequestId === 'string'
    ? clientRequestId.trim().slice(0, 100)
    : ''

  if (cleanClientRequestId) {
    const { data: existing, error: lookupError } = await db
      .from('easy_code_projects')
      .select('*')
      .eq('user_id', userId)
      .eq('client_request_id', cleanClientRequestId)
      .limit(1)
      .maybeSingle()
    throwIfEasyCodeIdempotencySchemaError(lookupError)
    if (lookupError) throw lookupError
    if (existing?.id) {
      console.info('[Easy Code] Reused idempotent project shell', { projectId: existing.id })
      const [files, messages] = await Promise.all([
        getEasyCodeFiles(userId, existing.id),
        getEasyCodeMessages(userId, existing.id),
      ])
      return { project: existing, files, messages, reused: true }
    }
  }

  const title = cleanPrompt.length > 56 ? `${cleanPrompt.slice(0, 56).trim()}...` : cleanPrompt
  const { data: project, error } = await db
    .from('easy_code_projects')
    .insert({
      user_id: userId,
      title,
      description: cleanPrompt,
      framework: 'detecting',
      generation_status: 'generating',
      generation_phase: 'creating_project',
      generation_error: null,
      generation_metadata: buildEasyCodeProgress('creating_project'),
      client_request_id: cleanClientRequestId || null,
    })
    .select('*')
    .single()
  throwIfEasyCodeIdempotencySchemaError(error)
  if (error?.code === '23505' && cleanClientRequestId) {
    const { data: existing, error: lookupError } = await db
      .from('easy_code_projects')
      .select('*')
      .eq('user_id', userId)
      .eq('client_request_id', cleanClientRequestId)
      .limit(1)
      .single()
    throwIfEasyCodeIdempotencySchemaError(lookupError)
    if (lookupError) throw lookupError
    if (existing?.id) {
      const [files, messages] = await Promise.all([
        getEasyCodeFiles(userId, existing.id),
        getEasyCodeMessages(userId, existing.id),
      ])
      return { project: existing, files, messages, reused: true }
    }
  }
  if (error || !project?.id) throw error || new Error('Could not create project.')

  await db.from('easy_code_messages').insert({ project_id: project.id, user_id: userId, role: 'user', content: cleanPrompt })
  const messages = await getEasyCodeMessages(userId, project.id)
  return { project, files: [], messages, reused: false }
}

export async function createEasyCodeProjectFromPrompt(userId: string, prompt: string) {
  const { project } = await createEasyCodeProjectShell(userId, prompt)
  await runEasyCodeInitialGeneration(userId, project.id)
  const [freshProject, freshFiles, freshMessages] = await Promise.all([
    getEasyCodeProject(userId, project.id),
    getEasyCodeFiles(userId, project.id),
    getEasyCodeMessages(userId, project.id),
  ])
  return { project: freshProject, files: freshFiles, messages: freshMessages, aiResult: null }
}

export async function runEasyCodeInitialGeneration(userId: string, projectId: string) {
  const project = await getEasyCodeProject(userId, projectId)
  if (!project) throw new Error('Project not found.')
  const cleanPrompt = sanitizeEasyCodePrompt(project.description || project.title)

  try {
    if (project.generation_status === 'generating' && project.generation_phase !== 'creating_project') {
      const updatedAt = project.updated_at ? Date.parse(project.updated_at) : 0
      const staleGeneration = !updatedAt || Date.now() - updatedAt > 90_000
      if (staleGeneration) {
        console.warn('[Easy Code] Reclaiming stale generation', {
          projectId,
          phase: project.generation_phase,
          updatedAt: project.updated_at,
        })
      } else {
      return {
        project,
        files: await getEasyCodeFiles(userId, projectId),
        messages: await getEasyCodeMessages(userId, projectId),
        aiResult: null,
        alreadyGenerating: true,
      }
      }
    }
    const db = await getDb()
    const existingFiles = await getEasyCodeFiles(userId, projectId)
    if (existingFiles.length > 0 && project.generation_status !== 'ready') {
      const { error: clearError } = await db
        .from('easy_code_files')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', userId)
      if (clearError) throw clearError
    }
    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'generating',
      phase: 'planning',
      error: null,
      metadata: buildEasyCodeProgress('planning'),
    })
    console.info('[Easy Code] Generation started', { projectId, mode: 'create' })
    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'generating',
      phase: 'generating_files',
      error: null,
      metadata: buildEasyCodeProgress('generating_files'),
    })

    const aiResult = await generateEasyCodeFiles({
      mode: 'create',
      project,
      files: [],
      messages: await getEasyCodeMessages(userId, projectId),
      instruction: cleanPrompt,
      projectId,
    })

    const filesCreated = aiResult.files.map(file => file.newPath || file.path)
    const staticLandingPage = isStaticLandingPageRequest(cleanPrompt)
    const missingStarterFiles = staticLandingPage ? getMissingStaticStarterFiles(aiResult.files) : []
    const proposedReadiness = getEasyCodeReadiness(aiResult.files.map(file => ({
      path: file.newPath || file.path,
      content: file.operation === 'delete' ? '' : file.content || '',
    })), project)
    console.info('[Easy Code] Generation output validated', {
      projectId,
      returnedFiles: aiResult.files.length,
      validatedFiles: proposedReadiness.fileCount,
      rejectedFiles: 0,
      meaningfulFiles: proposedReadiness.meaningfulFileCount,
      hasIndexHtml: proposedReadiness.hasIndexHtml,
      missingStarterFiles,
    })
    if (missingStarterFiles.length > 0) throw new Error('Generation incomplete. Retry.')
    if (!proposedReadiness.ready) throw new Error('Generation incomplete. Retry.')
    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'generating',
      phase: 'saving_files',
      metadata: buildEasyCodeProgress('saving_files', filesCreated),
    })

    await applyEasyCodeAiResult(userId, projectId, aiResult)
    const savedFiles = await getEasyCodeFiles(userId, projectId)
    const savedReadiness = getEasyCodeReadiness(savedFiles, {
      ...project,
      framework: aiResult.framework || project.framework,
    })
    const missingSavedStarterFiles = staticLandingPage ? getMissingStaticStarterFiles(savedFiles) : []
    console.info('[Easy Code] Generation files saved', {
      projectId,
      savedFiles: savedFiles.length,
      meaningfulFiles: savedReadiness.meaningfulFileCount,
      hasIndexHtml: savedReadiness.hasIndexHtml,
      missingStarterFiles: missingSavedStarterFiles,
    })
    if (missingSavedStarterFiles.length > 0) throw new Error('Generation incomplete. Retry.')
    if (!savedReadiness.ready) throw new Error('Generation incomplete. Retry.')
    await db.from('easy_code_projects')
      .update({
        title: aiResult.title || project.title,
        framework: aiResult.framework || project.framework,
        generation_status: 'generating',
        generation_phase: 'building_preview',
        generation_metadata: buildEasyCodeProgress('building_preview', filesCreated),
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)
      .eq('user_id', userId)
    await db.from('easy_code_messages').insert({
      project_id: projectId,
      user_id: userId,
      role: 'assistant',
      content: aiResult.summary,
      metadata: {
        instructions: aiResult.instructions,
        changedFiles: aiResult.files.map(file => ({ path: file.newPath || file.path, operation: file.operation })),
        previewType: aiResult.previewType,
      },
    })

    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'ready',
      phase: 'complete',
      error: null,
      metadata: buildEasyCodeProgress('complete', filesCreated),
      title: aiResult.title || project.title,
      framework: aiResult.framework || project.framework,
      lastGeneratedAt: new Date().toISOString(),
    })

    const [freshProject, freshFiles, freshMessages] = await Promise.all([
      getEasyCodeProject(userId, projectId),
      getEasyCodeFiles(userId, projectId),
      getEasyCodeMessages(userId, projectId),
    ])
    return { project: freshProject, files: freshFiles, messages: freshMessages, aiResult }
  } catch (error: any) {
    const message = getSafeEasyCodeError(error)
    const status = message === 'Generation incomplete. Retry.' ? 'incomplete' : 'failed'
    await updateEasyCodeGenerationState(userId, projectId, {
      status,
      phase: 'failed',
      error: message,
      metadata: buildEasyCodeProgress('failed', [], message),
    }).catch(() => {})
    console.error('[Easy Code] Status updated to failed', { message, projectId, timeoutHit: isTimeoutError(error) })
    throw new Error(message)
  }
}

export async function generateEasyCodeFiles(input: {
  mode: 'create' | 'edit'
  project: EasyCodeProject
  files: EasyCodeFile[]
  messages: EasyCodeMessage[]
  instruction: string
  selectedPath?: string | null
  projectId?: string
}): Promise<EasyCodeAiResult> {
  const staticLandingPage = input.mode === 'create' && isStaticLandingPageRequest(input.instruction)
  const fileTree = input.files.map(file => `${file.path} (${file.language || inferLanguage(file.path)}, ${file.size_bytes} bytes)`).join('\n') || 'No files yet.'
  const selectedFile = input.selectedPath
    ? input.files.find(file => file.path === input.selectedPath)
    : null
  const mentionedFiles = input.files.filter(file => input.instruction.toLowerCase().includes(file.path.toLowerCase()))
  const keyFiles = input.files.filter(file => /(^|\/)(package\.json|readme\.md|index\.html|src\/app|src\/main|src\/App|app\/page)/i.test(file.path))
  const contextFiles = Array.from(new Map([
    ...(selectedFile ? [[selectedFile.path, selectedFile]] as Array<[string, EasyCodeFile]> : []),
    ...mentionedFiles.map(file => [file.path, file] as [string, EasyCodeFile]),
    ...keyFiles.map(file => [file.path, file] as [string, EasyCodeFile]),
  ]).values()).slice(0, 10)

  const fileContext = contextFiles.map(file => [
    `--- FILE: ${file.path}`,
    file.content.slice(0, 18000),
  ].join('\n')).join('\n\n')

  const recentMessages = staticLandingPage ? '' : input.messages.slice(-10).map(message => `${message.role}: ${message.content}`).join('\n')
  const system = `You are Easy Code, a Lovable + Codex-style coding workspace inside EasyPlus. Use DeepSeek V4 Pro as a precise coding agent.
Return only strict JSON with this exact shape:
{"summary":"...","title":"optional project title","framework":"html|react|next|vite|python|node|other","previewType":"static-html|unsupported","instructions":["..."],"files":[{"path":"relative/path","language":"html|css|javascript|typescript|tsx|python|json|markdown|text","content":"full file content","operation":"create|update|delete|rename","newPath":"optional/new/path"}]}
Rules:
- Generate complete file contents, not patches.
- Use only relative paths. No absolute paths, no ../ traversal.
- Keep each file under ${EASY_CODE_MAX_FILE_BYTES} bytes.
- Return at most ${EASY_CODE_MAX_FILES_PER_AI_CALL} files.
- For simple landing pages, websites, portfolios, product pages, and business sites, generate only a lightweight static HTML project unless the user explicitly asks for React, Next.js, Vite, Node, or Python.
- Static first pass must contain exactly these four non-empty files: index.html, styles.css, script.js, README.md. Never return README only.
- Keep the first version compact but fully usable. Every created or updated file must have non-empty content.
- For React/Vite/Next/Python/Node projects, generate files and README/run instructions, but previewType should be unsupported unless there is a root index.html.
- Do not include secrets or API keys.
- For edits, update only the files needed.`

  const user = staticLandingPage
    ? `Mode: create
Project: ${input.project.title}
Description: ${input.project.description || ''}
Instruction: ${input.instruction}

Generate a polished but compact static landing page. Return JSON only.
Requirements:
- framework must be "html"
- previewType must be "static-html"
- files must be exactly: index.html, styles.css, script.js, README.md
- index.html should link styles.css and script.js
- include hero, services, benefits, pricing/packages or offers, testimonials, contact CTA, and responsive mobile layout
- script.js should add small safe interactions only, such as smooth scrolling or CTA handling
- keep each file concise and complete`
    : `Mode: ${input.mode}
Project: ${input.project.title}
Description: ${input.project.description || ''}
Instruction: ${input.instruction}

File tree:
${fileTree}

Recent Easy Code messages:
${recentMessages || 'None'}

Relevant file contents:
${fileContext || 'None'}`

  console.info('[Easy Code] DeepSeek generation prepared', {
    projectId: input.projectId || null,
    mode: input.mode,
    staticLandingPage,
  })
  const raw = await callAzureDeepSeekJson([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], staticLandingPage ? 4500 : input.mode === 'create' ? 8000 : 7000, {
    timeoutMs: staticLandingPage ? 45_000 : EASY_CODE_DEEPSEEK_TIMEOUT_MS,
    phase: staticLandingPage ? 'static_landing_generation' : 'deepseek_generation',
    projectId: input.projectId,
  })
  return parseEasyCodeJson(raw, input.projectId)
}

export async function applyEasyCodeAiResult(userId: string, projectId: string, aiResult: EasyCodeAiResult) {
  const db = await getDb()
  const existing = await getEasyCodeFiles(userId, projectId)
  if (existing.length + aiResult.files.filter(file => file.operation === 'create').length > EASY_CODE_MAX_PROJECT_FILES) {
    throw new Error('This Easy Code project has reached the file limit.')
  }

  let savedFiles = 0
  console.info('[Easy Code] Applying generated files', {
    projectId,
    returnedFiles: aiResult.files.length,
  })
  for (const file of aiResult.files) {
    const path = validateEasyCodePath(file.path)
    if (file.operation === 'delete') {
      await db.from('easy_code_files').delete().eq('project_id', projectId).eq('user_id', userId).eq('path', path)
      continue
    }
    if (file.operation === 'rename') {
      const newPath = validateEasyCodePath(file.newPath)
      await db.from('easy_code_files')
        .update({ path: newPath, updated_at: new Date().toISOString() })
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .eq('path', path)
      continue
    }
    const content = file.content || ''
    if (!content.trim()) throw new Error(`Generated file was empty: ${path}`)
    if (bytesOf(content) > EASY_CODE_MAX_FILE_BYTES) throw new Error(`File is too large: ${path}`)
    const { error } = await db.from('easy_code_files').upsert({
      project_id: projectId,
      user_id: userId,
      path,
      language: file.language || inferLanguage(path),
      content,
      size_bytes: bytesOf(content),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id,path' })
    if (error) throw error
    savedFiles += 1
  }
  await db.from('easy_code_projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', userId)
  console.info('[Easy Code] Applied generated files', { projectId, savedFiles })
}

export async function runEasyCodeEdit(userId: string, projectId: string, instruction: string, selectedPath?: string | null) {
  const [project, files, messages] = await Promise.all([
    getEasyCodeProject(userId, projectId),
    getEasyCodeFiles(userId, projectId),
    getEasyCodeMessages(userId, projectId),
  ])
  if (!project) throw new Error('Project not found.')
  const cleanInstruction = sanitizeEasyCodePrompt(instruction)
  if (cleanInstruction.length < 3) throw new Error('Describe the change you want.')

  const db = await getDb()
  await db.from('easy_code_messages').insert({ project_id: projectId, user_id: userId, role: 'user', content: cleanInstruction })
  const aiResult = await generateEasyCodeFiles({
    mode: 'edit',
    project,
    files,
    messages,
    instruction: cleanInstruction,
    selectedPath,
  })
  await applyEasyCodeAiResult(userId, projectId, aiResult)
  await db.from('easy_code_messages').insert({
    project_id: projectId,
    user_id: userId,
    role: 'assistant',
    content: aiResult.summary,
    metadata: {
      instructions: aiResult.instructions,
      changedFiles: aiResult.files.map(file => ({ path: file.newPath || file.path, operation: file.operation })),
      previewType: aiResult.previewType,
    },
  })
  const [freshFiles, freshMessages] = await Promise.all([
    getEasyCodeFiles(userId, projectId),
    getEasyCodeMessages(userId, projectId),
  ])
  return { files: freshFiles, messages: freshMessages, aiResult }
}

export function buildStaticPreviewHtml(files: EasyCodeFile[]): string | null {
  const index = files.find(file => file.path.toLowerCase() === 'index.html')
  if (!index) return null
  const fileMap = new Map(files.map(file => [file.path.toLowerCase(), file.content]))
  let html = index.content
  html = html.replace(/<link\s+[^>]*href=["']([^"']+)["'][^>]*>/gi, (match, href) => {
    const clean = href.replace(/^\.\//, '').toLowerCase()
    const css = fileMap.get(clean)
    return css && clean.endsWith('.css') ? `<style>\n${css}\n</style>` : match
  })
  html = html.replace(/<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (match, src) => {
    const clean = src.replace(/^\.\//, '').toLowerCase()
    const js = fileMap.get(clean)
    return js && clean.endsWith('.js') ? `<script>\n${js}\n</script>` : match
  })
  return html
}

export async function buildEasyCodeZip(project: EasyCodeProject, files: EasyCodeFile[]) {
  const zip = new JSZip()
  let totalBytes = 0
  const hasReadme = files.some(file => file.path.toLowerCase() === 'readme.md')
  for (const file of files) {
    const path = validateEasyCodePath(file.path)
    totalBytes += bytesOf(file.content)
    if (totalBytes > EASY_CODE_MAX_ZIP_BYTES) throw new Error('Download failed. Project is too large.')
    zip.file(path, file.content)
  }
  if (!hasReadme) {
    zip.file('README.md', `# ${project.title}\n\nGenerated with Easy Code inside EasyPlus.\n\nDownload and run locally according to the generated project files.\n`)
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
