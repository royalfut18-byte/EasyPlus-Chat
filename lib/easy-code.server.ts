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

export type EasyCodeOperation = 'create' | 'update' | 'delete' | 'rename'

export interface EasyCodeProject {
  id: string
  user_id: string
  title: string
  description: string | null
  framework: string | null
  status: string
  created_at: string
  updated_at: string
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

async function callAzureDeepSeekJson(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, maxTokens = 8192): Promise<string> {
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

  async function request(authMode: 'api-key' | 'bearer') {
    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authMode === 'api-key' ? { 'api-key': safeApiKey } : { Authorization: `Bearer ${safeApiKey}` }),
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(120_000),
    })
  }

  let response = await request('api-key')
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => {})
    response = await request('bearer')
  }

  if (!response.ok) {
    console.error('[Easy Code] DeepSeek request failed', {
      status: response.status,
      phase: 'deepseek_generation',
    })
    throw new Error(response.status === 429 ? 'Could not generate files. Please try again in a moment.' : 'Could not generate files.')
  }

  const data = await response.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('The AI returned invalid file data. Try again.')
  }
  return content
}

async function parseEasyCodeJson(text: string): Promise<EasyCodeAiResult> {
  try {
    return normalizeAiResult(JSON.parse(extractJson(text)))
  } catch {
    const repaired = await callAzureDeepSeekJson([
      {
        role: 'system',
        content: 'Return only valid JSON matching this schema: {"summary":string,"files":[{"path":string,"language":string,"content":string,"operation":"create|update|delete|rename","newPath":string}],"instructions":string[],"previewType":"static-html|unsupported","title":string,"framework":string}. Do not include markdown.',
      },
      { role: 'user', content: `Repair this invalid Easy Code response into valid JSON only:\n${text.slice(0, 20000)}` },
    ], 8192)
    return normalizeAiResult(JSON.parse(extractJson(repaired)))
  }
}

export async function requireEasyCodeUser(userId: string) {
  const db = await getDb()
  const block = getEntitlementBlockResponse(await getAccountEntitlement(db, userId))
  if (block) return block
  return null
}

export async function listEasyCodeProjects(userId: string): Promise<EasyCodeProject[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('easy_code_projects')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
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

export async function createEasyCodeProjectFromPrompt(userId: string, prompt: string) {
  const db = await getDb()
  const cleanPrompt = sanitizeEasyCodePrompt(prompt)
  if (cleanPrompt.length < 5) throw new Error('Describe what you want to build.')

  const title = cleanPrompt.length > 56 ? `${cleanPrompt.slice(0, 56).trim()}...` : cleanPrompt
  const { data: project, error } = await db
    .from('easy_code_projects')
    .insert({
      user_id: userId,
      title,
      description: cleanPrompt,
      framework: 'detecting',
    })
    .select('*')
    .single()
  if (error || !project?.id) throw error || new Error('Could not create project.')

  await db.from('easy_code_messages').insert({ project_id: project.id, user_id: userId, role: 'user', content: cleanPrompt })
  const aiResult = await generateEasyCodeFiles({
    mode: 'create',
    project,
    files: [],
    messages: [],
    instruction: cleanPrompt,
  })
  await applyEasyCodeAiResult(userId, project.id, aiResult)
  await db.from('easy_code_projects')
    .update({
      title: aiResult.title || project.title,
      framework: aiResult.framework || project.framework,
      updated_at: new Date().toISOString(),
    })
    .eq('id', project.id)
    .eq('user_id', userId)
  await db.from('easy_code_messages').insert({
    project_id: project.id,
    user_id: userId,
    role: 'assistant',
    content: aiResult.summary,
    metadata: {
      instructions: aiResult.instructions,
      changedFiles: aiResult.files.map(file => ({ path: file.newPath || file.path, operation: file.operation })),
      previewType: aiResult.previewType,
    },
  })

  const [freshProject, freshFiles, freshMessages] = await Promise.all([
    getEasyCodeProject(userId, project.id),
    getEasyCodeFiles(userId, project.id),
    getEasyCodeMessages(userId, project.id),
  ])
  return { project: freshProject, files: freshFiles, messages: freshMessages, aiResult }
}

export async function generateEasyCodeFiles(input: {
  mode: 'create' | 'edit'
  project: EasyCodeProject
  files: EasyCodeFile[]
  messages: EasyCodeMessage[]
  instruction: string
  selectedPath?: string | null
}): Promise<EasyCodeAiResult> {
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

  const recentMessages = input.messages.slice(-10).map(message => `${message.role}: ${message.content}`).join('\n')
  const system = `You are Easy Code, a Lovable + Codex-style coding workspace inside EasyPlus. Use DeepSeek V4 Pro as a precise coding agent.
Return only strict JSON with this exact shape:
{"summary":"...","title":"optional project title","framework":"html|react|next|vite|python|node|other","previewType":"static-html|unsupported","instructions":["..."],"files":[{"path":"relative/path","language":"html|css|javascript|typescript|tsx|python|json|markdown|text","content":"full file content","operation":"create|update|delete|rename","newPath":"optional/new/path"}]}
Rules:
- Generate complete file contents, not patches.
- Use only relative paths. No absolute paths, no ../ traversal.
- Keep each file under ${EASY_CODE_MAX_FILE_BYTES} bytes.
- Return at most ${EASY_CODE_MAX_FILES_PER_AI_CALL} files.
- For web landing pages, prefer a static index.html plus styles.css and script.js so in-app preview works.
- For React/Vite/Next/Python/Node projects, generate files and README/run instructions, but previewType should be unsupported unless there is a root index.html.
- Do not include secrets or API keys.
- For edits, update only the files needed.`

  const user = `Mode: ${input.mode}
Project: ${input.project.title}
Description: ${input.project.description || ''}
Instruction: ${input.instruction}

File tree:
${fileTree}

Recent Easy Code messages:
${recentMessages || 'None'}

Relevant file contents:
${fileContext || 'None'}`

  const raw = await callAzureDeepSeekJson([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], input.mode === 'create' ? 12000 : 10000)
  return parseEasyCodeJson(raw)
}

export async function applyEasyCodeAiResult(userId: string, projectId: string, aiResult: EasyCodeAiResult) {
  const db = await getDb()
  const existing = await getEasyCodeFiles(userId, projectId)
  if (existing.length + aiResult.files.filter(file => file.operation === 'create').length > EASY_CODE_MAX_PROJECT_FILES) {
    throw new Error('This Easy Code project has reached the file limit.')
  }

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
  }
  await db.from('easy_code_projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', userId)
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
