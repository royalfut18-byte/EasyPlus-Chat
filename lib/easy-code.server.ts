import 'server-only'

import JSZip from 'jszip'
import {
  generateAzureGpt54Json,
  getAzureGpt54ConfigSnapshot,
} from '@/lib/ai/azure-gpt54.server'
import {
  getCurrentEasyCodeProviderEnvDiagnostics,
  recordEasyCodeAiSuccess,
  recordEasyCodeFallbackUsage,
  recordEasyCodeProviderAttempt,
} from '@/lib/ai/easy-code-provider-diagnostics.server'
import {
  generateAzureDeepSeekJson,
  getAzureDeepSeekConfigSnapshot,
} from '@/lib/ai/azure-deepseek.server'
import { isAzureTextProviderError, type AzureProviderEnvStatus } from '@/lib/ai/azure-provider-error'
import { createServiceClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'

export const EASY_CODE_MAX_PROMPT_LENGTH = 4000
export const EASY_CODE_MAX_FILES_PER_AI_CALL = 28
export const EASY_CODE_MAX_FILE_BYTES = 220_000
export const EASY_CODE_MAX_PROJECT_FILES = 120
export const EASY_CODE_MAX_ZIP_BYTES = 12 * 1024 * 1024
const EASY_CODE_CREATE_TIMEOUT_MS = 90_000
const EASY_CODE_EDIT_TIMEOUT_MS = 90_000
const EASY_CODE_REPAIR_TIMEOUT_MS = 45_000
const EASY_CODE_STATIC_FILES = ['index.html', 'styles.css', 'script.js', 'README.md'] as const

type EasyCodeAiProvider = 'azure-gpt54' | 'azure-deepseek' | 'fallback'
type EasyCodeAiPhase = 'create' | 'edit' | 'repair'
type EasyCodePromptType = 'static-site' | 'app' | 'script' | 'other'

export interface EasyCodeAiDiagnostics {
  provider: EasyCodeAiProvider
  phase: EasyCodeAiPhase
  attemptedAt: string
  envConfigured: boolean
  envStatus: AzureProviderEnvStatus | null
  envValueLengths: {
    apiKey: number
    baseUrl: number
    model: number
  } | null
  endpointHost: string | null
  endpointPath: string | null
  finalRequestPath: string | null
  model: string | null
  providerStatusCode: number | null
  providerErrorCode: string | null
  providerErrorMessage: string | null
  responseFormatUsed: boolean
  timeoutHit: boolean
  fallbackUsed: boolean
  safeReason: string
  safeCode: string
}

interface EasyCodeGenerationPayload {
  aiResult: EasyCodeAiResult
  diagnostics: EasyCodeAiDiagnostics[]
  providerUsed: EasyCodeAiProvider
}

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
  const category = categorizeEasyCodeError(error)
  if (category === 'timeout') return 'AI generation timed out.'
  if (category === 'provider_not_configured') return 'AI provider is not configured.'
  if (category === 'provider_auth') return 'AI provider credentials are invalid or unauthorized.'
  if (category === 'deployment_not_found') return 'AI deployment was not found.'
  if (category === 'provider_busy') return 'AI provider is busy. Try again.'
  if (category === 'invalid_json' || category === 'invalid_changes' || category === 'no_valid_changes') return 'AI returned invalid file data.'
  if (category === 'generation_incomplete') return 'Generation incomplete. Retry.'
  if (category === 'save_failed') return typeof error?.message === 'string' && error.message ? error.message : 'Could not save updated files.'
  if (category === 'provider_unavailable' || category === 'unknown') return 'AI provider request failed.'
  return typeof error?.message === 'string' && error.message
    ? error.message
    : 'Project was created but generation failed.'
}

function categorizeEasyCodeError(error: any): string {
  const message = typeof error?.message === 'string' ? error.message : ''
  if (isTimeoutError(error)) return 'timeout'
  if (message === 'AI provider is not configured.') return 'provider_not_configured'
  if (message === 'Model provider is not configured.') return 'provider_not_configured'
  if (message === 'DeepSeek V4 Pro is not configured.') return 'provider_not_configured'
  if (message === 'AI provider request failed.') return 'provider_unavailable'
  if (message === 'AI generation timed out.') return 'timeout'
  if (message === 'AI provider credentials are invalid or unauthorized.') return 'provider_auth'
  if (message === 'AI deployment was not found.') return 'deployment_not_found'
  if (message === 'AI provider is busy. Try again.') return 'provider_busy'
  if (message === 'AI returned invalid file data.') return 'invalid_json'
  if (message === 'This EasyPlus mode is temporarily unavailable.') return 'provider_unavailable'
  if (message === 'DeepSeek V4 Pro is temporarily unavailable.') return 'provider_unavailable'
  if (message === 'Model provider is busy. Please try again.') return 'provider_busy'
  if (message === 'DeepSeek V4 Pro is temporarily busy. Please try again in a moment.') return 'provider_busy'
  if (message === 'Model provider credentials are invalid or unauthorized.') return 'provider_auth'
  if (message === 'Model deployment was not found.') return 'deployment_not_found'
  if (message === 'The AI returned invalid file data. Try again.') return 'invalid_json'
  if (message === 'The AI returned invalid file changes. Try again.') return 'invalid_changes'
  if (message === 'No valid file changes were returned. Try again.') return 'no_valid_changes'
  if (message === 'Could not save fallback files.') return 'save_failed'
  if (message === 'Could not save updated files.') return 'save_failed'
  if (message === 'Generation incomplete. Retry.') return 'generation_incomplete'
  return 'unknown'
}

function getEasyCodePhase(mode: 'create' | 'edit' | 'repair'): EasyCodeAiPhase {
  return mode
}

function getEasyCodeProviderSafeCode(provider: EasyCodeAiProvider, error?: any): string {
  const prefix = provider === 'azure-gpt54'
    ? 'gpt54'
    : provider === 'azure-deepseek'
      ? 'deepseek'
      : 'static'
  const category = categorizeEasyCodeError(error)
  const providerStatusCode = isAzureTextProviderError(error) ? error.status : null
  const providerErrorCode = isAzureTextProviderError(error) ? error.providerErrorCode : null
  const providerErrorMessage = `${isAzureTextProviderError(error) ? error.providerErrorMessage || error.message : error?.message || ''}`.toLowerCase()

  if (provider === 'fallback') return 'static_fallback_used'
  if (category === 'provider_not_configured') return `${prefix}_missing_env`
  if (category === 'timeout') return `${prefix}_timeout`
  if (providerStatusCode === 401) return `${prefix}_invalid_credentials_401`
  if (providerStatusCode === 403) return `${prefix}_forbidden_403`
  if (providerStatusCode === 404) return `${prefix}_deployment_not_found_404`
  if (providerStatusCode === 429) return `${prefix}_rate_limited_429`
  if (providerStatusCode === 400 && (providerErrorCode === 'unsupported_parameter' || providerErrorMessage.includes('unsupported parameter'))) {
    if (providerErrorMessage.includes('response_format') || providerErrorMessage.includes('json_object')) {
      return `${prefix}_response_format_rejected`
    }
    if (providerErrorMessage.includes('max_tokens') && providerErrorMessage.includes('max_completion_tokens')) {
      return `${prefix}_max_tokens_unsupported_400`
    }
    return `${prefix}_unsupported_parameter_400`
  }
  if (category === 'invalid_json' || category === 'invalid_changes' || category === 'no_valid_changes') return `${prefix}_invalid_json`
  if (category === 'provider_busy') return `${prefix}_rate_limited_429`
  if (category === 'provider_auth') return `${prefix}_invalid_credentials_${providerStatusCode || 'auth'}`
  if (category === 'deployment_not_found') return `${prefix}_deployment_not_found_${providerStatusCode || '404'}`
  if (providerStatusCode != null) return `${prefix}_request_failed_${providerStatusCode}`
  return `${prefix}_request_failed`
}

function getEasyCodeSafeReason(error: any): string {
  const category = categorizeEasyCodeError(error)
  if (category === 'timeout') return 'timed out'
  if (category === 'provider_not_configured') return 'provider not configured'
  if (category === 'provider_auth') return 'invalid credentials'
  if (category === 'deployment_not_found') return 'deployment not found'
  if (category === 'provider_busy') return 'provider busy'
  if (category === 'invalid_json' || category === 'invalid_changes' || category === 'no_valid_changes') return 'invalid JSON'
  if (category === 'provider_unavailable') return 'provider request failed'
  return typeof error?.message === 'string' && error.message
    ? error.message
    : 'provider request failed'
}

function getEasyCodeFallbackSummaryLead(error: any): string {
  const category = categorizeEasyCodeError(error)
  const firstAttempt: EasyCodeAiDiagnostics | undefined = Array.isArray(error?.easyCodeDiagnostics)
    ? error.easyCodeDiagnostics.find((item: EasyCodeAiDiagnostics) => item.provider === 'azure-gpt54') || error.easyCodeDiagnostics[0]
    : undefined
  if (category === 'provider_not_configured') return 'AI generation was unavailable because the provider is not configured, so'
  if (category === 'provider_auth') return 'AI generation was unavailable because the provider credentials were rejected, so'
  if (category === 'deployment_not_found') return 'AI generation was unavailable because the deployment was not found, so'
  if (category === 'provider_busy') return 'AI generation was unavailable because the provider is busy, so'
  if (category === 'timeout') return 'AI generation timed out, so'
  if (category === 'invalid_json' || category === 'invalid_changes' || category === 'no_valid_changes') return 'AI generation returned invalid file data, so'
  if (category === 'generation_incomplete') {
    const hadSuccessfulAiAttempt = Array.isArray(error?.easyCodeDiagnostics) &&
      error.easyCodeDiagnostics.some((item: EasyCodeAiDiagnostics) => item.provider === 'azure-gpt54' && item.providerStatusCode === 200)
    return hadSuccessfulAiAttempt
      ? 'AI generated a partial project that could not be completed automatically, so'
      : 'AI generation was incomplete, so'
  }
  if (firstAttempt?.safeCode === 'gpt54_max_tokens_unsupported_400') {
    return 'AI generation was unavailable because the GPT-5.4 request body was rejected, so'
  }
  if (firstAttempt?.safeCode === 'gpt54_response_format_rejected') {
    return 'AI generation was unavailable because the GPT-5.4 response format was rejected, so'
  }
  if (isAzureTextProviderError(error) && error.status === 400) {
    const detail = `${error.providerErrorCode || ''} ${error.providerErrorMessage || error.message || ''}`.toLowerCase()
    if (detail.includes('max_tokens') && detail.includes('max_completion_tokens')) {
      return 'AI generation was unavailable because the GPT-5.4 request body was rejected, so'
    }
    if (detail.includes('response_format') || detail.includes('json_object')) {
      return 'AI generation was unavailable because the GPT-5.4 response format was rejected, so'
    }
  }
  return 'AI generation was unavailable, so'
}

function buildEasyCodeProviderDiagnostics(
  provider: EasyCodeAiProvider,
  phase: EasyCodeAiPhase,
  snapshot: {
    endpointHost: string | null
    endpointPath: string
    model: string
    envStatus: AzureProviderEnvStatus
  } | null,
  error?: any,
  overrides: Partial<Pick<EasyCodeAiDiagnostics, 'providerStatusCode' | 'providerErrorCode' | 'providerErrorMessage' | 'responseFormatUsed' | 'timeoutHit' | 'fallbackUsed' | 'safeReason' | 'safeCode'>> = {}
): EasyCodeAiDiagnostics {
  const currentEnv = provider === 'azure-gpt54'
    ? getCurrentEasyCodeProviderEnvDiagnostics('gpt54')
    : provider === 'azure-deepseek'
      ? getCurrentEasyCodeProviderEnvDiagnostics('deepseek')
      : null
  return {
    provider,
    phase,
    attemptedAt: new Date().toISOString(),
    envConfigured: snapshot
      ? snapshot.envStatus.apiKey.configured &&
        snapshot.envStatus.baseUrl.configured &&
        snapshot.envStatus.model.configured
      : false,
    envStatus: snapshot?.envStatus || null,
    envValueLengths: currentEnv?.envValueLengths || null,
    endpointHost: snapshot?.endpointHost || null,
    endpointPath: snapshot?.endpointPath || null,
    finalRequestPath: currentEnv?.finalRequestPath || snapshot?.endpointPath || null,
    model: snapshot?.model || null,
    providerStatusCode: overrides.providerStatusCode ?? (isAzureTextProviderError(error) ? error.status : null),
    providerErrorCode: overrides.providerErrorCode ?? (isAzureTextProviderError(error) ? error.providerErrorCode : null),
    providerErrorMessage: overrides.providerErrorMessage ?? (isAzureTextProviderError(error) ? error.providerErrorMessage : null),
    responseFormatUsed: overrides.responseFormatUsed ?? false,
    timeoutHit: overrides.timeoutHit ?? Boolean(isAzureTextProviderError(error) ? error.timeoutHit : isTimeoutError(error)),
    fallbackUsed: overrides.fallbackUsed ?? provider !== 'azure-gpt54',
    safeReason: overrides.safeReason ?? getEasyCodeSafeReason(error),
    safeCode: overrides.safeCode ?? getEasyCodeProviderSafeCode(provider, error),
  }
}

function withEasyCodeDiagnostics(metadata: any, diagnostics: EasyCodeAiDiagnostics[], providerUsed?: EasyCodeAiProvider) {
  return {
    ...(metadata || {}),
    diagnostics: {
      providerUsed: providerUsed || null,
      fallbackUsed: providerUsed === 'azure-deepseek' || providerUsed === 'fallback',
      attempts: diagnostics,
    },
  }
}

function attachEasyCodeDiagnostics<T extends Error>(error: T, diagnostics: EasyCodeAiDiagnostics[]) {
  ;(error as T & { easyCodeDiagnostics?: EasyCodeAiDiagnostics[] }).easyCodeDiagnostics = diagnostics
  return error
}

function isStaticLandingPageRequest(input: string): boolean {
  const text = input.toLowerCase()
  const asksForOtherStack = /\b(react|next\.?js|vite|typescript|node|express|python|flask|fastapi|vue|svelte|angular)\b/.test(text)
  return !asksForOtherStack && /\b(landing page|website|web site|webpage|homepage|portfolio|business|carwash|car wash|car washing|detailing|simple site|html site)\b/.test(text)
}

function getMissingStaticStarterFiles(files: Array<Pick<EasyCodeFile, 'path'> | Pick<EasyCodeAiFile, 'path' | 'newPath'>>): string[] {
  const paths = new Set(files.map((file: any) => (file.newPath || file.path || '').toLowerCase()))
  return EASY_CODE_STATIC_FILES.filter(path => !paths.has(path.toLowerCase()))
}

function inferEasyCodePromptType(prompt: string, files: Array<Pick<EasyCodeFile, 'path'>> = []): EasyCodePromptType {
  const text = `${prompt}\n${files.map((file) => file.path).join('\n')}`.toLowerCase()
  if (/\b(landing page|website|web site|webpage|homepage|portfolio|business)\b/.test(text)) return 'static-site'
  if (/\b(script|automation|cli|cron|scraper|bot)\b/.test(text) || files.some((file) => /\.(js|ts|py|sh|ps1)$/i.test(file.path))) {
    return 'script'
  }
  if (/\b(app|dashboard|saas|platform|react|next\.?js|vite|node|python|api)\b/.test(text)) return 'app'
  return 'other'
}

function getEasyCodeProviderConfigurationSummary() {
  const gpt54 = getCurrentEasyCodeProviderEnvDiagnostics('gpt54')
  const deepseek = getCurrentEasyCodeProviderEnvDiagnostics('deepseek')
  return {
    gpt54Configured: gpt54.envConfigured,
    deepseekConfigured: deepseek.envConfigured,
    gpt54EndpointHost: gpt54.endpointHost,
    gpt54EndpointPath: gpt54.endpointPath,
    gpt54Model: gpt54.model,
    deepseekEndpointHost: deepseek.endpointHost,
    deepseekEndpointPath: deepseek.endpointPath,
    deepseekModel: deepseek.model,
  }
}

function getEasyCodeValidationSummary(
  outputDiagnostics: ReturnType<typeof getEasyCodeAiResultDiagnostics>,
  requiresStaticStarterFiles: boolean
) {
  const reasons: string[] = []
  if (requiresStaticStarterFiles && outputDiagnostics.missingStarterFiles.length > 0) {
    reasons.push(`missing_starter_files:${outputDiagnostics.missingStarterFiles.join(',')}`)
  }
  if (outputDiagnostics.readmeOnly) reasons.push('readme_only')
  if (!outputDiagnostics.readiness.ready) {
    reasons.push(
      `readiness_failed:meaningful=${outputDiagnostics.readiness.meaningfulFileCount},index=${outputDiagnostics.readiness.hasIndexHtml}`
    )
  }

  return {
    validationRejectedCount: reasons.length,
    validationRejectedReason: reasons.join('; ') || null,
  }
}

function getEasyCodeJsonSystemPrompt() {
  return `You are Easy Code, a high-end coding workspace inside EasyPlus. Act as a precise senior product engineer and designer.
Return only strict JSON with this exact shape:
{"summary":"...","title":"optional project title","framework":"html|react|next|vite|python|node|other","previewType":"static-html|unsupported","instructions":["..."],"files":[{"path":"relative/path","language":"html|css|javascript|typescript|tsx|python|json|markdown|text","content":"full file content","operation":"create|update|delete|rename","newPath":"optional/new/path"}]}
You may also return "operations" instead of "files" with the same array shape.
Rules:
- Return JSON only. No markdown fences. No prose outside JSON.
- Generate complete file contents, not patches.
- Use only relative paths. No absolute paths, no ../ traversal.
- Keep each file under ${EASY_CODE_MAX_FILE_BYTES} bytes.
- Return at most ${EASY_CODE_MAX_FILES_PER_AI_CALL} files.
- For simple landing pages, websites, portfolios, product pages, and business sites, generate only a static HTML project unless the user explicitly asks for React, Next.js, Vite, Node, or Python.
- Static first pass must contain exactly these four non-empty files: index.html, styles.css, script.js, README.md.
- Do not inline all CSS or JavaScript into index.html. Use external styles.css and script.js files.
- Never return README only.
- Never return zero files.
- Never use lorem ipsum, TODO placeholders, fake broken assets, or generic copy that sounds unfinished.
- No external paid dependencies. Keep simple landing pages fully static and previewable.
- Make landing pages feel premium: intentional layout, polished typography, strong spacing, rich sections, tasteful gradients, glass or layered surfaces when appropriate, motion, mobile responsiveness, and professional copywriting.
- For React/Vite/Next/Python/Node projects, generate files and README/run instructions, but previewType should be unsupported unless there is a root index.html.
- Do not include secrets or API keys.
- For edits, preserve the existing working structure and return only changed files as complete replacement content.
- For static HTML edits, read the current files carefully, improve the existing experience, and update index.html, styles.css, and script.js as needed.
- Do not expose backend providers, model names, or routing details.`
}

async function repairIncompleteStaticLandingPageGeneration(input: {
  project: Pick<EasyCodeProject, 'title' | 'description'>
  instruction: string
  projectId?: string
  priorResult: EasyCodeAiResult
  priorDiagnostics: EasyCodeAiDiagnostics[]
  missingStarterFiles: string[]
  validationRejectedReason: string | null
}): Promise<EasyCodeGenerationPayload> {
  const normalized = normalizeMeaningfulStaticAiOutput({
    aiResult: input.priorResult,
    instruction: input.instruction,
    projectTitle: input.project.title,
  })

  console.warn('[Easy Code] Static generation incomplete, requesting corrected AI pass', {
    projectId: input.projectId || null,
    aiReturnedFiles: input.priorResult.files.length,
    meaningfulAiOutput: normalized.meaningfulAiOutput,
    missingStarterFiles: input.missingStarterFiles,
    normalizedSingleFileHtml: normalized.normalizedSingleFileHtml,
    targetedCompletionAttempted: false,
    targetedCompletionSucceeded: false,
    validationRejectedReason: input.validationRejectedReason,
    priorFilesReturnedCount: input.priorResult.files.length,
    priorProviderAttempts: input.priorDiagnostics.length,
  })

  if (normalized.meaningfulAiOutput && normalized.missingStarterFiles.length === 0) {
    const priorProviderUsed = input.priorDiagnostics.find((item) => item.provider !== 'fallback')?.provider || 'azure-gpt54'
    console.info('[Easy Code] Incomplete static generation recovered locally', {
      projectId: input.projectId || null,
      aiReturnedFiles: input.priorResult.files.length,
      meaningfulAiOutput: true,
      missingStarterFiles: [],
      normalizedSingleFileHtml: normalized.normalizedSingleFileHtml,
      targetedCompletionAttempted: false,
      targetedCompletionSucceeded: false,
      fallbackUsed: false,
      fallbackReason: null,
    })
    return {
      aiResult: normalized.aiResult,
      diagnostics: input.priorDiagnostics,
      providerUsed: priorProviderUsed,
    }
  }

  const workingResult = normalized.meaningfulAiOutput ? normalized.aiResult : input.priorResult
  const workingMissingFiles = normalized.meaningfulAiOutput ? normalized.missingStarterFiles : input.missingStarterFiles

  try {
    const raw = await callEasyCodeJsonProvider([
      { role: 'system', content: getEasyCodeJsonSystemPrompt() },
      {
        role: 'user',
        content: `You already generated a custom static landing page, but the project files are incomplete.
Project: ${resolveStaticProjectTitle({ instruction: input.instruction, aiTitle: workingResult.title, projectTitle: input.project.title })}
Original description: ${input.project.description || ''}
Original instruction: ${input.instruction}
Missing required files: ${workingMissingFiles.join(', ') || 'none'}
Validation failure: ${input.validationRejectedReason || 'unknown'}

Current project JSON:
${JSON.stringify(workingResult).slice(0, 18000)}

Return only the missing project files needed to finish this exact static site.
Requirements:
- framework must be "html"
- previewType must be "static-html"
- final project must contain exactly: index.html, styles.css, script.js, README.md
- preserve the business name, topic, and custom copy from the original instruction
- keep the site premium, responsive, and production-ready
- if index.html needs updating to link styles.css or script.js, include an updated index.html too
- include polished hero, services/features, pricing/packages, testimonials, FAQ, and booking/contact CTA
- do not rewrite working files unless necessary
- do not return README only
- do not output markdown fences
- do not output prose outside JSON`,
      },
    ], 3200, {
      timeoutMs: EASY_CODE_CREATE_TIMEOUT_MS,
      phase: 'repair',
      projectId: input.projectId,
      promptType: 'static-site',
    })

    const parsed = await parseEasyCodeJson(raw.content, input.projectId, raw.diagnostics)
    const mergedFiles = mergeEasyCodeAiFiles(workingResult.files, parsed.aiResult.files)
    const completedTitle = resolveStaticProjectTitle({
      instruction: input.instruction,
      aiTitle: parsed.aiResult.title || workingResult.title,
      projectTitle: input.project.title,
    })
    const completedResult = normalizeMeaningfulStaticAiOutput({
      aiResult: {
        ...workingResult,
        ...parsed.aiResult,
        title: completedTitle,
        framework: 'html',
        previewType: 'static-html',
        summary: buildStaticAiSuccessSummary(completedTitle, 'completed'),
        files: mergedFiles,
      },
      instruction: input.instruction,
      projectTitle: input.project.title,
    })

    console.info('[Easy Code] Corrective static AI pass completed', {
      projectId: input.projectId || null,
      providerUsed: raw.providerUsed,
      returnedFiles: parsed.aiResult.files.length,
      filesReturnedCount: parsed.aiResult.files.length,
      meaningfulAiOutput: completedResult.meaningfulAiOutput,
      missingStarterFiles: completedResult.missingStarterFiles,
      normalizedSingleFileHtml: completedResult.normalizedSingleFileHtml,
      targetedCompletionAttempted: true,
      targetedCompletionSucceeded: completedResult.missingStarterFiles.length === 0,
      fallbackUsed: false,
      fallbackReason: null,
    })
    return {
      aiResult: completedResult.aiResult,
      diagnostics: [...input.priorDiagnostics, ...parsed.diagnostics],
      providerUsed: raw.providerUsed,
    }
  } catch (error: any) {
    const correctionDiagnostics = Array.isArray(error?.easyCodeDiagnostics) ? error.easyCodeDiagnostics : []
    console.error('[Easy Code] Corrective static AI pass failed', {
      projectId: input.projectId || null,
      meaningfulAiOutput: normalized.meaningfulAiOutput,
      missingStarterFiles: workingMissingFiles,
      normalizedSingleFileHtml: normalized.normalizedSingleFileHtml,
      targetedCompletionAttempted: true,
      targetedCompletionSucceeded: false,
      fallbackUsed: false,
      fallbackReason: null,
      message: error?.message || 'Unknown error',
    })
    throw attachEasyCodeDiagnostics(
      error instanceof Error ? error : new Error(String(error)),
      [...input.priorDiagnostics, ...correctionDiagnostics]
    )
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function inferStaticSiteTitle(prompt: string): string {
  const quotedMatch = prompt.match(/["“]([^"”]{2,80})["”]/)
  if (quotedMatch?.[1]) {
    return quotedMatch[1]
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  }
  const calledMatch = prompt.match(/\bcalled\s+["“]?([^"”\n]{2,80})["”]?/i)
  if (calledMatch?.[1]) {
    return calledMatch[1]
      .replace(/\b(landing page|website|web site|webpage|homepage)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  }
  const forMatch = prompt.match(/\bfor\s+["“]?([^"”\n]{2,80})["”]?\s*$/i)
  if (forMatch?.[1]) {
    return forMatch[1]
      .replace(/\b(landing page|website|web site|webpage|homepage)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  }
  const text = prompt.toLowerCase()
  if (/\b(pressure\s*wash|pressure\s*washing|power\s*wash|power\s*washing|soft\s*wash)\b/.test(text)) return 'Premier Pressure Washing'
  if (/\b(car\s*wash|car\s*washing|carwash)\b/.test(text)) return 'Premium Car Wash'
  if (/\b(car\s*detailing|detailing)\b/.test(text)) return 'Elite Auto Detailing'
  if (/\bbakery\b/.test(text)) return 'Artisan Bakery'
  if (/\bportfolio\b/.test(text)) return 'Creative Portfolio'
  const cleaned = prompt
    .replace(/^(make|build|create|design)\s+(me\s+)?(a|an)?\s*/i, '')
    .replace(/\b(landing page|website|web site|webpage|homepage|fully functional|simple site|html site)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Modern Business Website'
  return cleaned
    .split(' ')
    .slice(0, 5)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function resolveStaticProjectTitle(input: {
  instruction?: string
  aiTitle?: string
  projectTitle?: string
}) {
  const aiTitle = typeof input.aiTitle === 'string' ? input.aiTitle.trim() : ''
  if (aiTitle) return aiTitle.slice(0, 80)
  const sources = [input.instruction, input.projectTitle].filter((value): value is string => Boolean(value))
  for (const source of sources) {
    const inferred = inferStaticSiteTitle(source)
    if (inferred) return inferred
  }
  return 'Custom Landing Page'
}

function buildStaticAiSuccessSummary(title: string, variant: 'created' | 'normalized' | 'completed') {
  const normalizedTitle = title.replace(/\s+/g, ' ').trim() || 'custom landing page'
  const noun = /\b(landing page|website|site|homepage)\b/i.test(normalizedTitle)
    ? normalizedTitle
    : `${normalizedTitle} landing page`
  if (variant === 'normalized') {
    return `Created a custom ${noun} with AI and normalized it into project files.`
  }
  if (variant === 'completed') {
    return `Created a custom ${noun} with AI and completed the missing project files.`
  }
  return `Created a custom ${noun} with AI.`
}

function buildStaticAiReadme(title: string, summary: string) {
  return `# ${title}

${summary}

## Files

- index.html - page structure and content
- styles.css - responsive visual styling
- script.js - interactive behavior
- README.md - project notes

## Run locally

Open index.html in the Easy Code preview or a browser.
`
}

function insertBeforeClosingTag(html: string, closingTag: string, snippet: string) {
  const lower = html.toLowerCase()
  const index = lower.lastIndexOf(closingTag.toLowerCase())
  if (index >= 0) {
    return `${html.slice(0, index)}${snippet}${html.slice(index)}`
  }
  return `${html}${snippet}`
}

function normalizeMeaningfulStaticAiOutput(input: {
  aiResult: EasyCodeAiResult
  instruction: string
  projectTitle?: string
}) {
  const fileMap = new Map<string, EasyCodeAiFile>(
    input.aiResult.files
      .filter((file) => file.operation !== 'delete')
      .map((file) => [(file.newPath || file.path).toLowerCase(), { ...file } as EasyCodeAiFile])
  )
  const indexFile = fileMap.get('index.html')
  if (!indexFile?.content?.trim()) {
    return {
      aiResult: input.aiResult,
      meaningfulAiOutput: false,
      normalizedSingleFileHtml: false,
      missingStarterFiles: getMissingStaticStarterFiles(input.aiResult.files),
    }
  }

  const html = indexFile.content
  const meaningfulAiOutput = html.length >= 220 && /<(html|body|main|section|header|footer)\b/i.test(html)
  if (!meaningfulAiOutput) {
    return {
      aiResult: input.aiResult,
      meaningfulAiOutput: false,
      normalizedSingleFileHtml: false,
      missingStarterFiles: getMissingStaticStarterFiles(input.aiResult.files),
    }
  }

  const originalFileCount = fileMap.size
  let normalizedHtml = html
  const extractedCss: string[] = []
  const extractedJs: string[] = []

  normalizedHtml = normalizedHtml.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, css) => {
    const content = typeof css === 'string' ? css.trim() : ''
    if (content) extractedCss.push(content)
    return ''
  })

  normalizedHtml = normalizedHtml.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, scriptContent) => {
    const attrText = typeof attrs === 'string' ? attrs : ''
    if (/\bsrc\s*=/.test(attrText) || /\btype\s*=\s*["']application\/ld\+json["']/i.test(attrText)) {
      return match
    }
    const content = typeof scriptContent === 'string' ? scriptContent.trim() : ''
    if (content) extractedJs.push(content)
    return ''
  })

  const hasStylesFile = fileMap.has('styles.css')
  const hasScriptFile = fileMap.has('script.js')
  const hasReadmeFile = fileMap.has('readme.md')
  const needsStylesFile = !hasStylesFile && extractedCss.length > 0
  const needsScriptFile = !hasScriptFile && extractedJs.length > 0
  const title = resolveStaticProjectTitle({
    instruction: input.instruction,
    aiTitle: input.aiResult.title,
    projectTitle: input.projectTitle,
  })

  if ((needsStylesFile || hasStylesFile) && !/<link\b[^>]+href=["'][^"']*styles\.css["']/i.test(normalizedHtml)) {
    normalizedHtml = insertBeforeClosingTag(normalizedHtml, '</head>', '\n  <link rel="stylesheet" href="styles.css">\n')
  }
  if ((needsScriptFile || hasScriptFile) && !/<script\b[^>]+src=["'][^"']*script\.js["'][^>]*>\s*<\/script>/i.test(normalizedHtml)) {
    normalizedHtml = insertBeforeClosingTag(normalizedHtml, '</body>', '\n  <script src="script.js"></script>\n')
  }

  normalizedHtml = normalizedHtml.replace(/\n{3,}/g, '\n\n').trim()
  indexFile.content = normalizedHtml
  indexFile.language = 'html'
  indexFile.operation = 'create'
  fileMap.set('index.html', indexFile)

  if (needsStylesFile) {
    fileMap.set('styles.css', {
      path: 'styles.css',
      language: 'css',
      content: extractedCss.join('\n\n'),
      operation: 'create',
    })
  }
  if (needsScriptFile) {
    fileMap.set('script.js', {
      path: 'script.js',
      language: 'javascript',
      content: extractedJs.join('\n\n'),
      operation: 'create',
    })
  }
  if (!hasReadmeFile) {
    fileMap.set('readme.md', {
      path: 'README.md',
      language: 'markdown',
      content: buildStaticAiReadme(title, buildStaticAiSuccessSummary(title, 'created')),
      operation: 'create',
    })
  }

  const normalizedFiles = Array.from(fileMap.values())
  const normalizedSingleFileHtml = originalFileCount === 1 && normalizedFiles.length > 1
  const variant = normalizedSingleFileHtml ? 'normalized' : 'created'
  return {
    aiResult: {
      ...input.aiResult,
      title,
      framework: 'html',
      previewType: 'static-html' as const,
      summary: buildStaticAiSuccessSummary(title, variant),
      files: normalizedFiles,
    },
    meaningfulAiOutput,
    normalizedSingleFileHtml,
    missingStarterFiles: getMissingStaticStarterFiles(normalizedFiles),
  }
}

function mergeEasyCodeAiFiles(existing: EasyCodeAiFile[], incoming: EasyCodeAiFile[]) {
  const merged = new Map<string, EasyCodeAiFile>()
  for (const file of existing) {
    merged.set((file.newPath || file.path).toLowerCase(), file)
  }
  for (const file of incoming) {
    merged.set((file.newPath || file.path).toLowerCase(), file)
  }
  return Array.from(merged.values())
}

function buildFallbackStaticSite(prompt: string, reason: string): EasyCodeAiResult {
  const title = inferStaticSiteTitle(prompt)
  const safeTitle = escapeHtml(title)
  const summary = `${reason} Easy Code created a premium static website fallback you can keep refining.`
  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="page-shell">
    <header class="site-header">
      <nav class="nav">
        <a class="brand" href="#home">${safeTitle}</a>
        <button class="menu-button" aria-label="Toggle menu" aria-expanded="false">Menu</button>
        <div class="nav-links">
          <a href="#services">Services</a>
          <a href="#pricing">Pricing</a>
          <a href="#results">Results</a>
          <a href="#reviews">Reviews</a>
          <a href="#contact">Book now</a>
        </div>
      </nav>
    </header>

    <main>
      <section id="home" class="hero">
        <div class="hero-copy reveal">
          <span class="eyebrow">Premium mobile-first landing page</span>
          <h1>${safeTitle} that looks premium before the first rinse starts.</h1>
          <p class="lead">This fallback site is still high quality: strong copy, layered gradients, glass cards, pricing, testimonials, FAQ, and a booking section ready to customize.</p>
          <div class="hero-actions">
            <a class="button primary" href="#contact">Book a premium clean</a>
            <a class="button secondary" href="#pricing">See packages</a>
          </div>
          <ul class="hero-highlights">
            <li>Same-day appointment style layout</li>
            <li>Responsive premium UI</li>
            <li>Service, pricing, testimonial, FAQ, and booking sections</li>
          </ul>
        </div>

        <div class="hero-card reveal">
          <div class="hero-card-top">
            <span class="status-pill">Now booking this week</span>
            <strong>4.9/5 local rating</strong>
          </div>
          <div class="hero-card-grid">
            <article>
              <span>Express wash</span>
              <strong>45 min</strong>
              <p>Foam cannon, wheel detail, towel finish.</p>
            </article>
            <article>
              <span>Interior detail</span>
              <strong>90 min</strong>
              <p>Seats, trims, vents, and glass reset.</p>
            </article>
            <article>
              <span>Paint glow</span>
              <strong>Premium</strong>
              <p>Deep gloss finish with protection.</p>
            </article>
            <article>
              <span>Booking</span>
              <strong>Fast</strong>
              <p>CTA-ready design with polished form UI.</p>
            </article>
          </div>
        </div>
      </section>

      <section class="metrics reveal">
        <article><strong>1,200+</strong><span>cars refreshed</span></article>
        <article><strong>24h</strong><span>turnaround focus</span></article>
        <article><strong>3</strong><span>signature packages</span></article>
        <article><strong>100%</strong><span>mobile responsive</span></article>
      </section>

      <section id="services" class="section reveal">
        <div class="section-heading">
          <span class="eyebrow">Services</span>
          <h2>Designed to feel like a premium local brand, not a starter template.</h2>
        </div>
        <div class="service-grid">
          <article class="glass-card">
            <h3>Exterior shine</h3>
            <p>Snow foam pre-wash, contact-safe clean, wheel detail, and a gloss finish that photographs well.</p>
          </article>
          <article class="glass-card">
            <h3>Interior reset</h3>
            <p>Vacuuming, surface care, glass finishing, and a crisp cabin presentation for daily drivers.</p>
          </article>
          <article class="glass-card">
            <h3>Detail finish</h3>
            <p>Trim dressing, premium tire finishing, paint-safe finishing touches, and protection-focused care.</p>
          </article>
        </div>
      </section>

      <section id="pricing" class="section pricing reveal">
        <div class="section-heading">
          <span class="eyebrow">Pricing</span>
          <h2>Three clean packages with clear value.</h2>
        </div>
        <div class="pricing-grid">
          <article class="pricing-card">
            <p class="plan-name">Express</p>
            <strong>$39</strong>
            <ul>
              <li>Exterior wash</li>
              <li>Wheel face clean</li>
              <li>Quick dry finish</li>
            </ul>
            <a class="button secondary" href="#contact">Choose Express</a>
          </article>
          <article class="pricing-card featured">
            <p class="plan-name">Signature</p>
            <strong>$89</strong>
            <ul>
              <li>Exterior + interior refresh</li>
              <li>Trim and glass finishing</li>
              <li>Most popular package</li>
            </ul>
            <a class="button primary" href="#contact">Choose Signature</a>
          </article>
          <article class="pricing-card">
            <p class="plan-name">Showroom</p>
            <strong>$169</strong>
            <ul>
              <li>Deep detail package</li>
              <li>Gloss-focused finish</li>
              <li>Protection add-on ready</li>
            </ul>
            <a class="button secondary" href="#contact">Choose Showroom</a>
          </article>
        </div>
      </section>

      <section id="results" class="section reveal">
        <div class="section-heading">
          <span class="eyebrow">Before / after feel</span>
          <h2>Use styled placeholders until you add real photos.</h2>
        </div>
        <div class="showcase-grid">
          <article class="showcase-card before">
            <span>Before</span>
            <p>Muted finish, dusty panels, no visual punch.</p>
          </article>
          <article class="showcase-card after">
            <span>After</span>
            <p>Richer reflections, sharper contrast, premium clean energy.</p>
          </article>
        </div>
      </section>

      <section id="reviews" class="section reveal">
        <div class="section-heading">
          <span class="eyebrow">Testimonials</span>
          <h2>Strong social proof blocks already built in.</h2>
        </div>
        <div class="testimonial-grid">
          <article class="glass-card">
            <p>“The car looked photo-ready. The layout here already feels like a real premium business.”</p>
            <span>- Jordan, weekly customer</span>
          </article>
          <article class="glass-card">
            <p>“Fast, polished, and easy to book. This fallback is still far from generic.”</p>
            <span>- Priya, detailing client</span>
          </article>
          <article class="glass-card">
            <p>“The pricing and booking flow are clear, and the responsive design feels professional.”</p>
            <span>- Marcus, local driver</span>
          </article>
        </div>
      </section>

      <section class="section faq reveal">
        <div class="section-heading">
          <span class="eyebrow">FAQ</span>
          <h2>Answer common objections before the booking form.</h2>
        </div>
        <div class="faq-list">
          <details class="glass-card" open>
            <summary>Do I need to book in advance?</summary>
            <p>For busy weekends, yes. The booking section below is already styled so you can swap in your real process later.</p>
          </details>
          <details class="glass-card">
            <summary>Can I customize packages?</summary>
            <p>Yes. Update the pricing copy, add extras, and rename plans directly in Easy Code.</p>
          </details>
          <details class="glass-card">
            <summary>Will this work on mobile?</summary>
            <p>Yes. The layout, nav, cards, and booking area are responsive by default.</p>
          </details>
        </div>
      </section>

      <section id="contact" class="section booking reveal">
        <div class="booking-copy">
          <span class="eyebrow">Booking CTA</span>
          <h2>Turn interest into a booking-ready next step.</h2>
          <p>Replace the placeholders with your real suburb, pricing notes, phone number, and business hours.</p>
          <div class="contact-points">
            <span>(555) 123-4567</span>
            <span>hello@example.com</span>
            <span>Mon-Sat · 7:00am-6:00pm</span>
          </div>
        </div>
        <form class="booking-form">
          <label>
            <span>Name</span>
            <input type="text" placeholder="Your name">
          </label>
          <label>
            <span>Phone</span>
            <input type="tel" placeholder="Best contact number">
          </label>
          <label>
            <span>Vehicle</span>
            <input type="text" placeholder="SUV, sedan, ute...">
          </label>
          <label>
            <span>Preferred package</span>
            <select>
              <option>Express</option>
              <option>Signature</option>
              <option>Showroom</option>
            </select>
          </label>
          <label class="full-width">
            <span>Anything else?</span>
            <textarea rows="4" placeholder="Add timing, location, or requests"></textarea>
          </label>
          <button class="button primary full-width" type="submit">Request booking</button>
        </form>
      </section>
    </main>

    <footer class="site-footer">
      <p>&copy; <span id="year"></span> ${safeTitle}. Premium static fallback crafted inside Easy Code.</p>
    </footer>
  </div>

  <script src="script.js"></script>
</body>
</html>`

  const stylesCss = `:root {
  --bg: #07111a;
  --bg-soft: #101d29;
  --surface: rgba(255, 255, 255, 0.08);
  --surface-strong: rgba(255, 255, 255, 0.14);
  --line: rgba(255, 255, 255, 0.12);
  --text: #f5f7fb;
  --muted: #acb8c7;
  --cyan: #76e4ff;
  --blue: #67a5ff;
  --violet: #9b7bff;
  --shadow: 0 30px 90px rgba(0, 0, 0, 0.28);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  min-width: 320px;
  font-family: "Avenir Next", "Segoe UI", Inter, Arial, sans-serif;
  color: var(--text);
  background:
    radial-gradient(circle at top left, rgba(118, 228, 255, 0.15), transparent 30%),
    radial-gradient(circle at top right, rgba(155, 123, 255, 0.14), transparent 28%),
    linear-gradient(180deg, #08111a 0%, #0e1720 46%, #071018 100%);
}

a { color: inherit; text-decoration: none; }
button, input, select, textarea { font: inherit; }

.page-shell { min-height: 100vh; }
.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  backdrop-filter: blur(20px);
  background: rgba(7, 17, 26, 0.72);
  border-bottom: 1px solid var(--line);
}

.nav, .hero, .section, .metrics, .site-footer {
  width: min(1180px, calc(100% - 32px));
  margin: 0 auto;
}

.nav {
  min-height: 78px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.brand {
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: -0.04em;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 22px;
  color: var(--muted);
  font-size: 0.95rem;
}

.menu-button {
  display: none;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  border-radius: 999px;
  padding: 8px 14px;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
  gap: 28px;
  align-items: center;
  padding: 78px 0 42px;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--cyan);
}

h1, h2, h3, p { margin: 0; }
h1 {
  margin-top: 16px;
  font-size: clamp(3.2rem, 7vw, 6.4rem);
  line-height: 0.95;
  letter-spacing: -0.08em;
}

h2 {
  font-size: clamp(2rem, 4vw, 3.4rem);
  line-height: 0.98;
  letter-spacing: -0.06em;
}

h3 {
  font-size: 1.15rem;
  letter-spacing: -0.03em;
}

.lead, .glass-card p, .pricing-card li, .booking-copy p, .contact-points span, .showcase-card p {
  color: var(--muted);
  line-height: 1.7;
}

.hero-actions, .hero-highlights, .contact-points {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.hero-actions { margin-top: 28px; }

.hero-highlights {
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
}

.hero-highlights li,
.metrics article,
.status-pill,
.contact-points span {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 999px;
  padding: 10px 14px;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 50px;
  border-radius: 999px;
  padding: 0 22px;
  font-weight: 800;
  border: 0;
  cursor: pointer;
  transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
}

.button:hover { transform: translateY(-2px); }
.primary {
  background: linear-gradient(135deg, var(--cyan), var(--violet));
  color: #051019;
  box-shadow: 0 18px 45px rgba(118, 228, 255, 0.22);
}
.secondary {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}

.hero-card,
.glass-card,
.pricing-card,
.showcase-card,
.booking-form,
.faq-list details {
  border: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04));
  border-radius: 28px;
  box-shadow: var(--shadow);
}

.hero-card {
  padding: 28px;
  overflow: hidden;
}

.hero-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}

.hero-card-grid,
.service-grid,
.pricing-grid,
.showcase-grid,
.testimonial-grid,
.booking {
  display: grid;
  gap: 18px;
}

.hero-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.service-grid,
.pricing-grid,
.testimonial-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.showcase-grid,
.booking { grid-template-columns: repeat(2, minmax(0, 1fr)); }

.hero-card-grid article,
.pricing-card,
.showcase-card,
.glass-card,
.booking-form {
  padding: 24px;
}

.hero-card-grid span,
.plan-name { color: var(--muted); font-size: 0.86rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; }
.hero-card-grid strong,
.pricing-card strong,
.metrics strong {
  display: block;
  margin: 10px 0 8px;
  font-size: clamp(1.8rem, 4vw, 2.8rem);
  letter-spacing: -0.08em;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  padding-bottom: 18px;
}

.metrics article { padding: 18px 20px; }
.metrics span { display: block; color: var(--muted); }

.section { padding: 54px 0; }
.section-heading {
  max-width: 760px;
  margin-bottom: 24px;
}

.featured {
  background: linear-gradient(160deg, rgba(118,228,255,0.22), rgba(155,123,255,0.18));
  transform: translateY(-8px);
  border-color: rgba(118, 228, 255, 0.32);
}

.pricing-card ul {
  margin: 18px 0 24px;
  padding-left: 18px;
}

.showcase-card {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  justify-content: end;
}

.before {
  background:
    linear-gradient(180deg, rgba(10, 16, 24, 0.2), rgba(10, 16, 24, 0.75)),
    linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
}

.after {
  background:
    radial-gradient(circle at top left, rgba(118,228,255,0.18), transparent 32%),
    linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04));
}

.testimonial-grid article span { display: block; margin-top: 16px; color: var(--muted); font-size: 0.9rem; }

.faq-list {
  display: grid;
  gap: 14px;
}

.faq-list summary {
  cursor: pointer;
  font-weight: 700;
  list-style: none;
}

.faq-list summary::-webkit-details-marker { display: none; }
.faq-list details p { margin-top: 12px; }

.booking-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.booking-form label {
  display: grid;
  gap: 8px;
  color: var(--muted);
  font-size: 0.95rem;
}

.booking-form input,
.booking-form select,
.booking-form textarea {
  width: 100%;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 18px;
  background: rgba(7, 17, 26, 0.64);
  color: var(--text);
  padding: 14px 16px;
}

.booking-form input::placeholder,
.booking-form textarea::placeholder { color: #8a95a6; }

.full-width { grid-column: 1 / -1; }

.site-footer {
  padding: 24px 0 42px;
  color: var(--muted);
  text-align: center;
}

.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 480ms ease, transform 480ms ease;
}

.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.glass-card:hover,
.pricing-card:hover,
.showcase-card:hover,
.hero-card:hover {
  transform: translateY(-4px);
  border-color: rgba(118, 228, 255, 0.24);
}

@media (max-width: 980px) {
  .hero,
  .showcase-grid,
  .booking,
  .pricing-grid,
  .service-grid,
  .testimonial-grid,
  .metrics {
    grid-template-columns: 1fr;
  }

  .hero-card-grid,
  .booking-form {
    grid-template-columns: 1fr 1fr;
  }

  .featured { transform: none; }
}

@media (max-width: 760px) {
  .nav { position: relative; }
  .menu-button { display: inline-flex; }
  .nav-links {
    display: none;
  }
  .nav.open .nav-links {
    position: absolute;
    left: 0;
    right: 0;
    top: 70px;
    display: grid;
    gap: 14px;
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: 20px;
    background: rgba(10, 18, 27, 0.96);
  }
  .hero { padding-top: 44px; }
  .hero-card-grid,
  .booking-form {
    grid-template-columns: 1fr;
  }
}`

  const scriptJs = `document.getElementById('year').textContent = new Date().getFullYear();

const nav = document.querySelector('.nav');
const menuButton = document.querySelector('.menu-button');
const revealItems = document.querySelectorAll('.reveal');

menuButton?.addEventListener('click', () => {
  const open = nav?.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
});

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', () => {
    nav?.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  });
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add('is-visible');
  });
}, { threshold: 0.14 });

revealItems.forEach((item) => observer.observe(item));

document.querySelector('.booking-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  if (button) {
    const original = button.textContent;
    button.textContent = 'Request sent';
    setTimeout(() => {
      button.textContent = original;
    }, 1800);
  }
});`

  const readme = `# ${title}

${summary}

## Files

- index.html - page structure and content
- styles.css - responsive visual styling
- script.js - menu and navigation behavior
- README.md - project notes

## Run locally

Open index.html in a browser. Replace the placeholder business details and package copy directly in Easy Code.
`

  return {
    summary,
    title,
    framework: 'html',
    previewType: 'static-html',
    instructions: ['Open index.html in a browser or use the built-in preview.', 'Replace the placeholder business details before publishing.'],
    files: [
      { path: 'index.html', language: 'html', content: indexHtml, operation: 'create' },
      { path: 'styles.css', language: 'css', content: stylesCss, operation: 'create' },
      { path: 'script.js', language: 'javascript', content: scriptJs, operation: 'create' },
      { path: 'README.md', language: 'markdown', content: readme, operation: 'create' },
    ],
  }
}

function buildFallbackStaticEdit(files: EasyCodeFile[], instruction: string, reason: string): EasyCodeAiResult {
  const fileMap = new Map(files.map(file => [file.path.toLowerCase(), file]))
  const index = fileMap.get('index.html')
  const styles = fileMap.get('styles.css')
  const script = fileMap.get('script.js')
  const summary = `${reason} Easy Code applied a safe starter edit to the static site.`
  const lowerInstruction = instruction.toLowerCase()
  const wantsPricing = /\b(pricing|prices|packages|plans)\b/.test(lowerInstruction)
  const wantsPremium = /\b(premium|better|visual|appealing|modern|polished|animations?|improve)\b/.test(lowerInstruction)
  const operations: EasyCodeAiFile[] = []

  if (index) {
    let html = index.content
    if (wantsPricing && !/\bid=["']pricing["']/i.test(html)) {
      const pricingSection = `
    <section id="pricing" class="section pricing-section">
      <p class="section-kicker">Packages</p>
      <h2>Choose the perfect clean.</h2>
      <div class="pricing-grid">
        <article><span>Express</span><strong>$29</strong><p>Quick exterior shine for busy days.</p></article>
        <article class="featured"><span>Premium</span><strong>$79</strong><p>Interior refresh, exterior wash, and tire shine.</p></article>
        <article><span>Signature</span><strong>$149</strong><p>Full detail with protection and finishing touches.</p></article>
      </div>
    </section>
`
      html = html.replace(/(\s*<section id=["']contact["'][\s\S]*$)/i, `${pricingSection}$1`)
    }
    if (wantsPremium && !/premium-ribbon/.test(html)) {
      html = html.replace(/(<div class=["']hero-content["'][^>]*>)/i, `$1\n        <span class="premium-ribbon">Premium finish. Local service. Fast booking.</span>`)
    }
    operations.push({ path: 'index.html', language: 'html', content: html, operation: 'update' })
  }

  if (styles) {
    const premiumCss = `

/* Easy Code premium edit */
.premium-ribbon {
  display: inline-flex;
  margin-bottom: 18px;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 999px;
  padding: 8px 14px;
  color: #dff7ff;
  background: linear-gradient(135deg, rgba(57,213,255,0.16), rgba(124,60,255,0.18));
  box-shadow: 0 16px 40px rgba(57,213,255,0.12);
  font-size: 0.82rem;
  font-weight: 800;
}
.pricing-section { position: relative; }
.pricing-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  margin-top: 26px;
}
.pricing-grid article {
  border: 1px solid var(--line);
  border-radius: 24px;
  padding: 24px;
  background: rgba(255,255,255,0.06);
}
.pricing-grid .featured {
  background: linear-gradient(145deg, rgba(57,213,255,0.16), rgba(124,60,255,0.16));
  transform: translateY(-6px);
}
.pricing-grid span { color: var(--muted); font-weight: 800; }
.pricing-grid strong {
  display: block;
  margin: 12px 0;
  font-size: 2.4rem;
  letter-spacing: -0.06em;
}
.cards article, .hero-card, .contact, .testimonials {
  transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
}
.cards article:hover, .hero-card:hover {
  transform: translateY(-4px);
  border-color: rgba(57,213,255,0.28);
  box-shadow: 0 28px 90px rgba(57,213,255,0.12);
}
@media (max-width: 760px) {
  .pricing-grid { grid-template-columns: 1fr; }
  .pricing-grid .featured { transform: none; }
}
`
    operations.push({
      path: 'styles.css',
      language: 'css',
      content: styles.content.includes('/* Easy Code premium edit */') ? styles.content : `${styles.content.trim()}\n${premiumCss}`,
      operation: 'update',
    })
  }

  if (script) {
    const enhancement = `

document.querySelectorAll('.button').forEach((button) => {
  button.addEventListener('mouseenter', () => button.classList.add('is-hovered'));
  button.addEventListener('mouseleave', () => button.classList.remove('is-hovered'));
});`
    operations.push({
      path: 'script.js',
      language: 'javascript',
      content: script.content.includes("button.classList.add('is-hovered')") ? script.content : `${script.content.trim()}\n${enhancement}`,
      operation: 'update',
    })
  }

  return {
    summary,
    framework: 'html',
    previewType: 'static-html',
    instructions: ['Review the updated preview.', 'Download ZIP when you are happy with the changes.'],
    files: operations,
  }
}

type StaticWebsiteFallbackTheme = {
  title: string
  eyebrow: string
  heroTitle: string
  heroLead: string
  stats: Array<{ label: string; value: string }>
  services: Array<{ title: string; body: string }>
  results: Array<{ title: string; body: string }>
  pricing: Array<{ name: string; price: string; body: string; features: string[]; featured?: boolean }>
  testimonials: Array<{ quote: string; author: string }>
  faqs: Array<{ question: string; answer: string }>
  ctaTitle: string
  ctaLead: string
  ctaOptions: string[]
}

function getStaticWebsiteFallbackTheme(prompt: string, title: string): StaticWebsiteFallbackTheme {
  const text = prompt.toLowerCase()
  if (/\b(pressure\s*wash|pressure\s*washing|power\s*wash|power\s*washing|soft\s*wash)\b/.test(text)) {
    return {
      title,
      eyebrow: 'Exterior cleaning specialists',
      heroTitle: 'Restore driveways, siding, and storefronts with a premium pressure washing web presence.',
      heroLead: 'Easy Code kept this project usable with a polished static fallback designed for local trust, before-and-after selling, pricing packages, and fast quote requests.',
      stats: [
        { label: 'Average reply time', value: '10 min' },
        { label: 'Recurring clients', value: '72%' },
        { label: '5-star reviews', value: '148+' },
      ],
      services: [
        { title: 'Driveways and paths', body: 'Highlight visible stain removal, algae cleanup, and curb appeal improvements with clear homeowner-friendly language.' },
        { title: 'House washing', body: 'Position soft-wash safe cleaning for siding, render, brick, and eaves without sounding generic or overly technical.' },
        { title: 'Commercial frontage', body: 'Present shopfront, entryway, awning, and car park cleaning as a fast-turnaround image upgrade for businesses.' },
      ],
      results: [
        { title: 'Before and after selling', body: 'Frame each service around visible transformation, safer surfaces, and a cleaner property presentation.' },
        { title: 'Trust-building structure', body: 'Packages, testimonials, and FAQ content answer objections before the customer needs to ask.' },
      ],
      pricing: [
        { name: 'Refresh', price: '$149', body: 'Fast uplift for smaller exterior areas.', features: ['Driveway or patio clean', 'Edge rinse and tidy finish', '48-hour booking window'] },
        { name: 'Signature', price: '$289', body: 'Best-selling package for a visible property reset.', features: ['Driveway and path cleaning', 'Entry and facade treatment', 'Photo-ready finish'], featured: true },
        { name: 'Property Reset', price: '$499', body: 'Premium package for larger homes and mixed-use exteriors.', features: ['Full exterior wash plan', 'Soft-wash safe treatment', 'Priority walkthrough'] },
      ],
      testimonials: [
        { quote: 'Our driveway and facade looked brand new, and the quote flow felt easy.', author: 'Mia R., homeowner' },
        { quote: 'The site feels premium and credible instead of looking like a placeholder.', author: 'Leo T., local operator' },
        { quote: 'This kept the project launchable even while AI generation was unavailable.', author: 'Priya N., property manager' },
      ],
      faqs: [
        { question: 'Do you handle delicate exterior surfaces?', answer: 'Yes. The copy structure supports both pressure washing and soft-wash positioning so you can tailor the exact services you offer.' },
        { question: 'Can I add commercial packages later?', answer: 'Yes. The pricing section is easy to extend for strata, retail, and recurring maintenance work.' },
        { question: 'Will preview and download work immediately?', answer: 'Yes. This fallback includes the required starter files for preview, ZIP export, and follow-up edits.' },
      ],
      ctaTitle: 'Quote jobs faster and look established from day one.',
      ctaLead: 'Use this premium fallback as a working first version while provider access is restored, then refine the copy, pricing, and booking details inside Easy Code.',
      ctaOptions: ['Driveway cleaning', 'House wash', 'Commercial exterior', 'Custom quote'],
    }
  }

  return {
    title,
    eyebrow: 'Premium business website',
    heroTitle: 'Launch a premium static website that is ready to preview immediately.',
    heroLead: 'This deterministic fallback keeps the project useful with polished sections, responsive design, and starter files that are easy to refine.',
    stats: [
      { label: 'Preview status', value: 'Ready' },
      { label: 'Starter files', value: '4' },
      { label: 'Launch speed', value: 'Same day' },
    ],
    services: [
      { title: 'Clear positioning', body: 'A strong hero, service cards, and benefits section help visitors understand the offer quickly.' },
      { title: 'Commercial polish', body: 'Layered backgrounds, premium cards, and careful spacing stop the site from feeling generic.' },
      { title: 'Simple editing flow', body: 'The starter files remain straightforward so future edits stay easy inside Easy Code.' },
    ],
    results: [
      { title: 'Previewable immediately', body: 'The fallback includes index.html, styles.css, script.js, and README.md so the workspace stays usable.' },
      { title: 'Built for follow-up edits', body: 'The structure is intentionally clean so future AI or manual improvements do not require a rebuild.' },
    ],
    pricing: [
      { name: 'Starter', price: '$99', body: 'Simple offer for quick conversions.', features: ['Core service section', 'Responsive starter site', 'Single CTA flow'] },
      { name: 'Growth', price: '$249', body: 'Balanced package with stronger proof and premium detail.', features: ['Expanded sections', 'Social proof cards', 'Priority CTA layout'], featured: true },
      { name: 'Premium', price: '$499', body: 'High-ticket presentation for premium positioning.', features: ['Feature-rich layout', 'Polished visuals', 'Custom-ready structure'] },
    ],
    testimonials: [
      { quote: 'This gave us a strong starting point instead of a dead-end failed project.', author: 'Avery L.' },
      { quote: 'It looks intentional and polished, not like a throwaway placeholder.', author: 'Noah C.' },
      { quote: 'The preview was useful immediately and easy to refine.', author: 'Sofia W.' },
    ],
    faqs: [
      { question: 'Can this be customised for my business?', answer: 'Yes. Replace the business name, copy, pricing, and contact details directly in the starter files.' },
      { question: 'Why was a fallback created?', answer: 'The AI provider was unavailable, so Easy Code generated a deterministic static website to keep the project usable.' },
      { question: 'Can I keep editing from here?', answer: 'Yes. Follow-up edits can improve the existing files without duplicating the project.' },
    ],
    ctaTitle: 'Keep the project moving instead of waiting on provider recovery.',
    ctaLead: 'This fallback is intentionally premium, editable, and previewable so you still have a useful first version in the workspace.',
    ctaOptions: ['Starter package', 'Growth package', 'Premium package', 'Custom enquiry'],
  }
}

function createGuaranteedStaticWebsiteFallback(prompt: string, title = inferStaticSiteTitle(prompt), reason = 'AI generation was unavailable, so'): EasyCodeAiResult {
  const theme = getStaticWebsiteFallbackTheme(prompt, title)
  const summary = `${reason} Easy Code created a premium static website fallback.`
  const safeTitle = escapeHtml(theme.title)
  const servicesMarkup = theme.services.map((item) => `
          <article class="feature-card">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.body)}</p>
          </article>`).join('')
  const resultsMarkup = theme.results.map((item) => `
          <article class="result-card">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.body)}</p>
          </article>`).join('')
  const pricingMarkup = theme.pricing.map((item) => `
          <article class="price-card${item.featured ? ' featured' : ''}">
            <div class="price-head">
              <span class="plan">${escapeHtml(item.name)}</span>
              <strong>${escapeHtml(item.price)}</strong>
              <p>${escapeHtml(item.body)}</p>
            </div>
            <ul>
              ${item.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}
            </ul>
            <a class="button ${item.featured ? 'primary' : 'secondary'}" href="#contact">Choose ${escapeHtml(item.name)}</a>
          </article>`).join('')
  const testimonialMarkup = theme.testimonials.map((item) => `
          <article class="testimonial-card">
            <p>"${escapeHtml(item.quote)}"</p>
            <strong>${escapeHtml(item.author)}</strong>
          </article>`).join('')
  const faqMarkup = theme.faqs.map((item, index) => `
          <article class="faq-item${index === 0 ? ' open' : ''}">
            <button class="faq-question" type="button" aria-expanded="${index === 0 ? 'true' : 'false'}">${escapeHtml(item.question)}</button>
            <div class="faq-answer"><p>${escapeHtml(item.answer)}</p></div>
          </article>`).join('')
  const statsMarkup = theme.stats.map((item) => `
            <article class="metric">
              <strong>${escapeHtml(item.value)}</strong>
              <span>${escapeHtml(item.label)}</span>
            </article>`).join('')
  const optionsMarkup = theme.ctaOptions.map((item) => `<option>${escapeHtml(item)}</option>`).join('')

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <meta name="description" content="${escapeHtml(theme.heroLead)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="page-shell">
    <header class="site-header">
      <nav class="nav">
        <a class="brand" href="#home">${safeTitle}</a>
        <button class="menu-button" type="button" aria-label="Toggle menu" aria-expanded="false">Menu</button>
        <div class="nav-links">
          <a href="#services">Services</a>
          <a href="#results">Before / After</a>
          <a href="#pricing">Pricing</a>
          <a href="#testimonials">Testimonials</a>
          <a href="#faq">FAQ</a>
          <a href="#contact">Book now</a>
        </div>
      </nav>
    </header>

    <main>
      <section id="home" class="hero section">
        <div class="hero-copy reveal">
          <span class="eyebrow">${escapeHtml(theme.eyebrow)}</span>
          <h1>${escapeHtml(theme.heroTitle)}</h1>
          <p class="lead">${escapeHtml(theme.heroLead)}</p>
          <div class="hero-actions">
            <a class="button primary" href="#contact">Request a quote</a>
            <a class="button secondary" href="#pricing">View packages</a>
          </div>
          <div class="metrics-grid">
            ${statsMarkup}
          </div>
        </div>

        <aside class="hero-panel reveal">
          <span class="eyebrow">Premium static fallback</span>
          <h2>Built to stay useful even when AI generation is unavailable.</h2>
          <p>The starter includes the required four files, responsive design, and sections tuned for immediate preview and follow-up edits.</p>
          <ul class="hero-points">
            <li>Hero section with strong CTA</li>
            <li>Services, before/after, pricing, testimonials, and FAQ</li>
            <li>Preview-ready HTML, CSS, JavaScript, and README</li>
          </ul>
        </aside>
      </section>

      <section id="services" class="section reveal">
        <div class="section-heading">
          <span class="eyebrow">Services</span>
          <h2>Structure that sells the job clearly.</h2>
        </div>
        <div class="card-grid">
          ${servicesMarkup}
        </div>
      </section>

      <section id="results" class="section reveal">
        <div class="section-heading">
          <span class="eyebrow">Before / After</span>
          <h2>Show visible outcomes, not vague promises.</h2>
        </div>
        <div class="results-grid">
          ${resultsMarkup}
        </div>
      </section>

      <section id="pricing" class="section reveal">
        <div class="section-heading">
          <span class="eyebrow">Pricing Packages</span>
          <h2>Clear packages that support upsells without clutter.</h2>
        </div>
        <div class="pricing-grid">
          ${pricingMarkup}
        </div>
      </section>

      <section id="testimonials" class="section reveal">
        <div class="section-heading">
          <span class="eyebrow">Testimonials</span>
          <h2>Trust signals that make the business feel established.</h2>
        </div>
        <div class="card-grid">
          ${testimonialMarkup}
        </div>
      </section>

      <section id="faq" class="section reveal">
        <div class="section-heading">
          <span class="eyebrow">FAQ</span>
          <h2>Answer the last questions before the customer reaches out.</h2>
        </div>
        <div class="faq-list">
          ${faqMarkup}
        </div>
      </section>

      <section id="contact" class="section contact-section reveal">
        <div class="contact-copy">
          <span class="eyebrow">Booking CTA</span>
          <h2>${escapeHtml(theme.ctaTitle)}</h2>
          <p>${escapeHtml(theme.ctaLead)}</p>
        </div>
        <form class="contact-card">
          <label>
            Name
            <input type="text" placeholder="Alex Morgan">
          </label>
          <label>
            Email
            <input type="email" placeholder="alex@example.com">
          </label>
          <label>
            Service
            <select>
              ${optionsMarkup}
            </select>
          </label>
          <button class="button primary" type="button" id="demo-submit">Request booking</button>
          <p class="fine-print">Demo interaction only. Connect this CTA to your real booking or lead form when ready.</p>
        </form>
      </section>
    </main>

    <footer class="site-footer">
      <p>&copy; <span id="year"></span> ${safeTitle}. Premium static fallback crafted inside Easy Code.</p>
    </footer>
  </div>

  <script src="script.js"></script>
</body>
</html>
`

  const stylesCss = `:root {
  --bg: #08131f;
  --panel: rgba(8, 19, 31, 0.78);
  --line: rgba(255, 255, 255, 0.1);
  --text: #f5f7fb;
  --muted: #a8b8cb;
  --accent-soft: rgba(112, 215, 255, 0.16);
  --shadow: 0 24px 90px rgba(0, 0, 0, 0.34);
  --radius-xl: 30px;
  --radius-lg: 22px;
  color-scheme: dark;
  font-family: "Instrument Sans", sans-serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--text);
  background:
    radial-gradient(circle at top left, rgba(34, 182, 255, 0.3), transparent 34%),
    radial-gradient(circle at 85% 0%, rgba(136, 240, 196, 0.16), transparent 24%),
    linear-gradient(180deg, #07111c 0%, #0b1827 46%, #07111c 100%);
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: radial-gradient(circle at center, black 42%, transparent 86%);
}
a { color: inherit; text-decoration: none; }
button, input, select { font: inherit; }
.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  backdrop-filter: blur(22px);
  background: rgba(6, 16, 28, 0.72);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.nav, .section, .site-footer {
  width: min(1160px, calc(100% - 2rem));
  margin: 0 auto;
}
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 0;
}
.brand, h1, h2, h3, .price-head strong, .metric strong { font-family: "Space Grotesk", sans-serif; }
.brand {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.menu-button {
  display: none;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  border-radius: 999px;
  padding: 0.7rem 1rem;
}
.nav-links {
  display: flex;
  align-items: center;
  gap: 1.1rem;
  color: var(--muted);
}
.hero {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 1.25rem;
  padding-top: 4.5rem;
}
.section { padding: 1.5rem 0 2.25rem; }
.hero-copy, .hero-panel, .feature-card, .result-card, .price-card, .testimonial-card, .faq-item, .contact-card {
  background: linear-gradient(180deg, rgba(17, 34, 55, 0.86), rgba(8, 19, 31, 0.9));
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}
.hero-copy, .hero-panel, .contact-card {
  border-radius: var(--radius-xl);
  padding: 2rem;
}
.feature-card, .result-card, .price-card, .testimonial-card, .faq-item { border-radius: var(--radius-lg); padding: 1.3rem; }
.eyebrow, .plan {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.38rem 0.8rem;
  background: var(--accent-soft);
  color: #e4f8ff;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
h1, h2 { margin: 1rem 0 0.8rem; line-height: 0.98; }
h1 { font-size: clamp(2.8rem, 6vw, 5rem); }
h2 { font-size: clamp(2rem, 4vw, 3rem); }
.lead, .hero-panel p, .feature-card p, .result-card p, .price-head p, .testimonial-card p, .faq-answer p, .contact-copy p, .fine-print, label {
  color: var(--muted);
  line-height: 1.7;
}
.hero-actions { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1.6rem 0; }
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 0.95rem 1.3rem;
  border: 1px solid transparent;
  font-weight: 700;
  cursor: pointer;
}
.button.primary { background: linear-gradient(135deg, #7ce6ff, #22b6ff); color: #05111a; }
.button.secondary { border-color: var(--line); background: rgba(255, 255, 255, 0.02); }
.metrics-grid, .card-grid, .pricing-grid, .results-grid, .contact-section { display: grid; gap: 1rem; }
.metrics-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.metric { border-radius: var(--radius-lg); padding: 1.15rem; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); }
.metric strong { display: block; font-size: 1.55rem; }
.metric span { color: var(--muted); }
.hero-points, .price-card ul { margin: 1rem 0 0; padding-left: 1.1rem; color: var(--muted); }
.card-grid, .pricing-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.results-grid, .contact-section { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.price-card.featured { transform: translateY(-0.35rem); border-color: rgba(124, 230, 255, 0.32); }
.price-head strong { display: block; font-size: 2rem; margin: 0.6rem 0 0.3rem; }
.faq-list { display: grid; gap: 0.9rem; }
.faq-item { overflow: hidden; }
.faq-question {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 1.1rem 1.2rem;
  font-weight: 700;
  cursor: pointer;
}
.faq-answer {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.24s ease, padding 0.24s ease;
  padding: 0 1.2rem;
}
.faq-item.open .faq-answer { max-height: 200px; padding-bottom: 1rem; }
.contact-card { display: grid; gap: 0.95rem; }
.contact-card label { display: grid; gap: 0.45rem; }
.contact-card input, .contact-card select {
  border-radius: 14px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  padding: 0.9rem 0.95rem;
}
.site-footer { padding: 0 0 2.6rem; color: var(--muted); }
.reveal { opacity: 0; transform: translateY(22px); transition: opacity 0.55s ease, transform 0.55s ease; }
.reveal.visible { opacity: 1; transform: translateY(0); }
@media (max-width: 980px) {
  .hero, .results-grid, .contact-section, .card-grid, .pricing-grid { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .nav { align-items: flex-start; flex-direction: column; }
  .menu-button { display: inline-flex; }
  .nav-links {
    display: none;
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
    padding-top: 0.6rem;
  }
  .nav-links.open { display: flex; }
  .hero { padding-top: 3.6rem; }
  .hero-copy, .hero-panel, .contact-card { padding: 1.35rem; }
  .metrics-grid { grid-template-columns: 1fr; }
}
`

  const scriptJs = `const menuButton = document.querySelector('.menu-button');
const navLinks = document.querySelector('.nav-links');
const faqButtons = document.querySelectorAll('.faq-question');
const revealItems = document.querySelectorAll('.reveal');
const submitButton = document.getElementById('demo-submit');
const year = document.getElementById('year');

if (year) year.textContent = new Date().getFullYear().toString();

if (menuButton && navLinks) {
  menuButton.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
  });
}

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const href = link.getAttribute('href');
    if (!href) return;
    const target = document.querySelector(href);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    navLinks?.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  });
});

faqButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const item = button.closest('.faq-item');
    if (!item) return;
    const open = item.classList.toggle('open');
    button.setAttribute('aria-expanded', String(open));
  });
});

if (submitButton) {
  submitButton.addEventListener('click', () => {
    submitButton.textContent = 'Quote requested';
    submitButton.setAttribute('disabled', 'true');
    window.setTimeout(() => {
      submitButton.textContent = 'Request booking';
      submitButton.removeAttribute('disabled');
    }, 1600);
  });
}

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.16 });

revealItems.forEach((item) => revealObserver.observe(item));
`

  const readme = `# ${theme.title}

${summary}

## Included files

- \`index.html\`
- \`styles.css\`
- \`script.js\`
- \`README.md\`

## What this fallback includes

- Responsive premium landing page
- Hero, services, before/after, pricing, testimonials, FAQ, and booking CTA
- Preview-ready static HTML, CSS, and JavaScript

## Next steps

1. Open \`index.html\` in the Easy Code preview or a browser.
2. Replace the business details, service copy, and pricing.
3. Connect the CTA to your real booking or quote flow when ready.
`

  const files: EasyCodeAiFile[] = [
    { path: 'index.html', language: 'html', content: indexHtml, operation: 'create' },
    { path: 'styles.css', language: 'css', content: stylesCss, operation: 'create' },
    { path: 'script.js', language: 'javascript', content: scriptJs, operation: 'create' },
    { path: 'README.md', language: 'markdown', content: readme, operation: 'create' },
  ]

  const guaranteedFiles = EASY_CODE_STATIC_FILES.map((path) => {
    const existing = files.find((file) => file.path === path)
    if (existing?.content?.trim()) return existing
    if (path === 'index.html') return { path, language: 'html', content: '<!doctype html><title>Fallback</title><h1>Fallback website</h1>', operation: 'create' as const }
    if (path === 'styles.css') return { path, language: 'css', content: 'body { font-family: sans-serif; }', operation: 'create' as const }
    if (path === 'script.js') return { path, language: 'javascript', content: 'console.log("Easy Code fallback ready");', operation: 'create' as const }
    return { path, language: 'markdown', content: `# ${theme.title}\n`, operation: 'create' as const }
  })

  return {
    summary,
    title: theme.title,
    framework: 'html',
    previewType: 'static-html',
    instructions: [
      'Customize the business copy and pricing in index.html.',
      'Adjust the visual design in styles.css.',
      'Connect the CTA behavior in script.js.',
    ],
    files: guaranteedFiles,
  }
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
  const files = Array.isArray(raw?.files)
    ? raw.files
    : Array.isArray(raw?.operations)
      ? raw.operations
      : []
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

function getEasyCodeAiResultDiagnostics(
  aiResult: EasyCodeAiResult,
  project?: Pick<EasyCodeProject, 'description' | 'framework'> | null
) {
  const projectedFiles = aiResult.files
    .filter((file) => file.operation !== 'delete')
    .map((file) => ({
      path: file.newPath || file.path,
      content: file.content || '',
    }))
  const readiness = getEasyCodeReadiness(projectedFiles, project)
  const meaningfulFiles = projectedFiles.filter((file) => file.path.toLowerCase() !== 'readme.md' && file.content.trim().length > 0)
  const readmeOnly = meaningfulFiles.length === 0 && projectedFiles.some((file) => file.path.toLowerCase() === 'readme.md')
  const missingStarterFiles = getMissingStaticStarterFiles(projectedFiles)

  return {
    readiness,
    projectedFiles,
    meaningfulFiles,
    readmeOnly,
    missingStarterFiles,
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

async function callEasyCodeJsonProvider(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  maxTokens = 8192,
  options: { timeoutMs?: number; phase?: EasyCodeAiPhase; projectId?: string; promptType?: EasyCodePromptType } = {}
): Promise<{ content: string; providerUsed: 'azure-gpt54' | 'azure-deepseek'; diagnostics: EasyCodeAiDiagnostics[] }> {
  const timeoutMs = options.timeoutMs || EASY_CODE_CREATE_TIMEOUT_MS
  const phase = options.phase || 'create'
  const providerConfig = getEasyCodeProviderConfigurationSummary()
  const diagnostics: EasyCodeAiDiagnostics[] = []
  const tryProvider = async (
    provider: 'azure-gpt54' | 'azure-deepseek',
    run: () => Promise<string>,
    snapshot: ReturnType<typeof getAzureGpt54ConfigSnapshot> | ReturnType<typeof getAzureDeepSeekConfigSnapshot>,
    providerOptions: { responseFormatUsed?: boolean } = {}
  ) => {
    const startedAt = Date.now()
    const requestStartedAt = new Date(startedAt).toISOString()
    const currentEnv = provider === 'azure-gpt54'
      ? getCurrentEasyCodeProviderEnvDiagnostics('gpt54')
      : getCurrentEasyCodeProviderEnvDiagnostics('deepseek')
    console.info('[Easy Code] AI provider request started', {
      projectId: options.projectId || null,
      phase,
      promptType: options.promptType || 'other',
      maxTokens,
      timeoutMs,
      provider,
      providerAttempted: provider === 'azure-gpt54' ? 'gpt54' : 'deepseek',
      requestStartedAt,
      gpt54Configured: providerConfig.gpt54Configured,
      deepseekConfigured: providerConfig.deepseekConfigured,
      envExists: currentEnv.envExists,
      apiKeySource: currentEnv.apiKeySource || null,
      baseUrlSource: currentEnv.baseUrlSource || null,
      modelSource: currentEnv.modelSource || null,
      endpointHost: snapshot.endpointHost,
      endpointPath: snapshot.endpointPath,
      finalRequestPath: currentEnv.finalRequestPath,
      model: snapshot.model,
      envConfigured: snapshot.envStatus.apiKey.configured &&
        snapshot.envStatus.baseUrl.configured &&
        snapshot.envStatus.model.configured,
      envValueLengths: currentEnv.envValueLengths,
    })
    try {
      const content = await run()
      const providerDiagnostics = buildEasyCodeProviderDiagnostics(provider, phase, snapshot, null, {
        providerStatusCode: 200,
        responseFormatUsed: providerOptions.responseFormatUsed ?? false,
        timeoutHit: false,
        fallbackUsed: provider !== 'azure-gpt54',
        safeReason: 'available',
        safeCode: provider === 'azure-gpt54' ? 'gpt54_available' : 'deepseek_available',
      })
      recordEasyCodeProviderAttempt({
        provider: provider === 'azure-gpt54' ? 'gpt54' : 'deepseek',
        phase,
        attemptedAt: providerDiagnostics.attemptedAt,
        endpointHost: providerDiagnostics.endpointHost,
        endpointPath: providerDiagnostics.endpointPath,
        finalRequestPath: providerDiagnostics.finalRequestPath,
        model: providerDiagnostics.model,
        statusCode: providerDiagnostics.providerStatusCode,
        providerErrorCode: providerDiagnostics.providerErrorCode,
        providerErrorMessage: providerDiagnostics.providerErrorMessage,
        responseFormatUsed: providerDiagnostics.responseFormatUsed,
        timeoutHit: providerDiagnostics.timeoutHit,
        fallbackUsed: providerDiagnostics.fallbackUsed,
        safeReason: providerDiagnostics.safeReason,
        safeCode: providerDiagnostics.safeCode,
      })
      diagnostics.push(providerDiagnostics)
      console.info('[Easy Code] AI provider request ended', {
        projectId: options.projectId || null,
        phase,
        promptType: options.promptType || 'other',
        durationMs: Date.now() - startedAt,
        responseChars: content.length,
        provider,
        providerAttempted: provider === 'azure-gpt54' ? 'gpt54' : 'deepseek',
        providerStatusCode: 200,
        timeoutHit: false,
        responseFormatUsed: providerDiagnostics.responseFormatUsed,
        fallbackUsed: providerDiagnostics.fallbackUsed,
        finalStatus: 'provider_succeeded',
      })
      return { content, providerUsed: provider, diagnostics }
    } catch (error: any) {
      const providerDiagnostics = buildEasyCodeProviderDiagnostics(provider, phase, snapshot, error, {
        responseFormatUsed: providerOptions.responseFormatUsed ?? false,
        fallbackUsed: provider !== 'azure-gpt54',
      })
      recordEasyCodeProviderAttempt({
        provider: provider === 'azure-gpt54' ? 'gpt54' : 'deepseek',
        phase,
        attemptedAt: providerDiagnostics.attemptedAt,
        endpointHost: providerDiagnostics.endpointHost,
        endpointPath: providerDiagnostics.endpointPath,
        finalRequestPath: providerDiagnostics.finalRequestPath,
        model: providerDiagnostics.model,
        statusCode: providerDiagnostics.providerStatusCode,
        providerErrorCode: providerDiagnostics.providerErrorCode,
        providerErrorMessage: providerDiagnostics.providerErrorMessage,
        responseFormatUsed: providerDiagnostics.responseFormatUsed,
        timeoutHit: providerDiagnostics.timeoutHit,
        fallbackUsed: providerDiagnostics.fallbackUsed,
        safeReason: providerDiagnostics.safeReason,
        safeCode: providerDiagnostics.safeCode,
      })
      diagnostics.push(providerDiagnostics)
      console.error('[Easy Code] AI provider request failed', {
        projectId: options.projectId || null,
        phase,
        promptType: options.promptType || 'other',
        durationMs: Date.now() - startedAt,
        provider,
        providerAttempted: provider === 'azure-gpt54' ? 'gpt54' : 'deepseek',
        providerStatusCode: providerDiagnostics.providerStatusCode,
        providerErrorCode: providerDiagnostics.providerErrorCode,
        timeoutHit: providerDiagnostics.timeoutHit,
        responseFormatUsed: providerDiagnostics.responseFormatUsed,
        safeReason: providerDiagnostics.safeReason,
        safeCode: providerDiagnostics.safeCode,
        fallbackUsed: providerDiagnostics.fallbackUsed,
        finalStatus: 'provider_failed',
      })
      return null
    }
  }

  const gptAttempt = await tryProvider(
    'azure-gpt54',
    () => generateAzureGpt54Json(messages, {
      maxTokens,
      temperature: 0.2,
      timeoutMs,
      phase,
      projectId: options.projectId,
      responseFormat: 'text',
    }),
    getAzureGpt54ConfigSnapshot(),
    { responseFormatUsed: false }
  )
  if (gptAttempt) return gptAttempt

  const deepSeekAttempt = await tryProvider(
    'azure-deepseek',
    () => generateAzureDeepSeekJson(messages, {
      maxTokens,
      temperature: 0.2,
      timeoutMs,
      phase,
      projectId: options.projectId,
    }),
    getAzureDeepSeekConfigSnapshot(),
    { responseFormatUsed: false }
  )
  if (deepSeekAttempt) return deepSeekAttempt

  const gptFailure = diagnostics.find((item) => item.provider === 'azure-gpt54')
  throw attachEasyCodeDiagnostics(new Error(gptFailure?.safeReason || 'provider not configured'), diagnostics)
}

async function parseEasyCodeJson(
  text: string,
  projectId?: string,
  priorDiagnostics: EasyCodeAiDiagnostics[] = []
): Promise<{ aiResult: EasyCodeAiResult; diagnostics: EasyCodeAiDiagnostics[] }> {
  try {
    const result = normalizeAiResult(JSON.parse(extractJson(text)))
    console.info('[Easy Code] JSON parse succeeded', {
      projectId: projectId || null,
      jsonParseSuccess: true,
      repairAttempted: false,
      repairSuccess: false,
      fileCount: result.files.length,
    })
    return { aiResult: result, diagnostics: priorDiagnostics }
  } catch (parseError: any) {
    console.warn('[Easy Code] JSON parse failed, attempting one repair pass', {
      projectId: projectId || null,
      jsonParseSuccess: false,
      repairAttempted: true,
      message: parseError?.message,
    })
    const repaired = await callEasyCodeJsonProvider([
      {
        role: 'system',
        content: 'Return only valid JSON matching this schema: {"summary":string,"files":[{"path":string,"language":string,"content":string,"operation":"create|update|delete|rename","newPath":string}],"instructions":string[],"previewType":"static-html|unsupported","title":string,"framework":string}. Do not include markdown.',
      },
      { role: 'user', content: `Repair this invalid Easy Code response into valid JSON only:\n${text.slice(0, 20000)}` },
    ], 4096, { timeoutMs: EASY_CODE_REPAIR_TIMEOUT_MS, phase: 'repair', projectId, promptType: 'other' })
    try {
      const result = normalizeAiResult(JSON.parse(extractJson(repaired.content)))
      console.info('[Easy Code] JSON repair succeeded', {
        projectId: projectId || null,
        jsonParseSuccess: true,
        fileCount: result.files.length,
        repairAttempted: true,
        repairPassSuccess: true,
        repairSuccess: true,
      })
      return { aiResult: result, diagnostics: [...priorDiagnostics, ...repaired.diagnostics] }
    } catch (repairError: any) {
      console.error('[Easy Code] JSON repair failed', {
        projectId: projectId || null,
        jsonParseSuccess: false,
        message: repairError?.message,
        repairAttempted: true,
        repairPassSuccess: false,
        repairSuccess: false,
        errorCategory: categorizeEasyCodeError(repairError),
      })
      throw attachEasyCodeDiagnostics(repairError, [...priorDiagnostics, ...repaired.diagnostics])
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

export function buildEasyCodeProgress(phase: string, filesCreated: string[] = [], error?: string | null, kind?: 'static_site' | 'generic') {
  const staticMode = kind === 'static_site' || EASY_CODE_STATIC_FILES.some(path => filesCreated.includes(path))
  const order = ['creating_project', 'planning', 'generating_files', 'saving_files', 'building_preview', 'complete']
  const currentIndex = order.indexOf(phase)
  const stateFor = (step: string) => {
    if (phase === 'failed') return 'pending'
    const stepIndex = order.indexOf(step)
    if (currentIndex > stepIndex) return 'done'
    if (currentIndex === stepIndex) return 'active'
    return 'pending'
  }
  const progress = staticMode ? [
      { label: 'Project created', state: phase === 'creating_project' ? 'active' : 'done' },
      { label: 'Planning static site', state: stateFor('planning') },
      { label: 'Creating index.html', state: stateFor('generating_files') },
      { label: 'Creating styles.css', state: stateFor('generating_files') },
      { label: 'Creating script.js', state: stateFor('generating_files') },
      { label: 'Creating README.md', state: stateFor('generating_files') },
      { label: 'Saving files', state: stateFor('saving_files') },
      { label: 'Preparing preview', state: stateFor('building_preview') },
      { label: 'Ready to download', state: phase === 'complete' ? 'done' : 'pending' },
    ] : [
      { label: 'Project created', state: phase === 'creating_project' ? 'active' : 'done' },
      { label: 'Planning file structure', state: stateFor('planning') },
      { label: 'Writing files', state: stateFor('generating_files') },
      { label: 'Saving files', state: stateFor('saving_files') },
      { label: 'Preparing preview', state: stateFor('building_preview') },
      { label: 'Ready to download', state: phase === 'complete' ? 'done' : 'pending' },
    ]
  return {
    progress,
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
  const staticLandingPage = isStaticLandingPageRequest(cleanPrompt)
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
      framework: staticLandingPage ? 'html' : 'detecting',
      generation_status: 'generating',
      generation_phase: 'creating_project',
      generation_error: null,
      generation_metadata: buildEasyCodeProgress('creating_project', staticLandingPage ? [...EASY_CODE_STATIC_FILES] : [], null, staticLandingPage ? 'static_site' : 'generic'),
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
  const staticLandingPage = isStaticLandingPageRequest(cleanPrompt)
  const promptType = inferEasyCodePromptType(cleanPrompt)

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
      metadata: buildEasyCodeProgress('planning', [], null, staticLandingPage ? 'static_site' : 'generic'),
    })
    console.info('[Easy Code] Generation started', {
      projectId,
      mode: 'create',
      promptType,
    })
    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'generating',
      phase: 'generating_files',
      error: null,
      metadata: buildEasyCodeProgress('generating_files', staticLandingPage ? [...EASY_CODE_STATIC_FILES] : [], null, staticLandingPage ? 'static_site' : 'generic'),
    })

    const generation = await generateEasyCodeFiles({
      mode: 'create',
      project,
      files: [],
      messages: await getEasyCodeMessages(userId, projectId),
      instruction: cleanPrompt,
      projectId,
    })
    let { aiResult, diagnostics: aiDiagnostics, providerUsed } = generation

    let filesCreated = aiResult.files.map(file => file.newPath || file.path)
    let outputDiagnostics = getEasyCodeAiResultDiagnostics(aiResult, project)
    let missingStarterFiles = staticLandingPage ? outputDiagnostics.missingStarterFiles : []
    let proposedReadiness = outputDiagnostics.readiness
    let validationSummary = getEasyCodeValidationSummary(outputDiagnostics, staticLandingPage)
    console.info('[Easy Code] Generation output validated', {
      projectId,
      phase: 'create',
      promptType,
      returnedFiles: aiResult.files.length,
      filesReturnedCount: aiResult.files.length,
      meaningfulAiOutput: proposedReadiness.hasIndexHtml && proposedReadiness.meaningfulFileCount > 0,
      validatedFiles: proposedReadiness.fileCount,
      validationRejectedCount: validationSummary.validationRejectedCount,
      validationRejectedReason: validationSummary.validationRejectedReason,
      meaningfulFiles: proposedReadiness.meaningfulFileCount,
      hasIndexHtml: proposedReadiness.hasIndexHtml,
      missingStarterFiles,
      readmeOnly: outputDiagnostics.readmeOnly,
      providerUsed,
    })

    if (staticLandingPage && (missingStarterFiles.length > 0 || outputDiagnostics.readmeOnly || !proposedReadiness.ready)) {
      const correctedGeneration = await repairIncompleteStaticLandingPageGeneration({
        project,
        instruction: cleanPrompt,
        projectId,
        priorResult: aiResult,
        priorDiagnostics: aiDiagnostics,
        missingStarterFiles,
        validationRejectedReason: validationSummary.validationRejectedReason,
      })

      aiResult = correctedGeneration.aiResult
      aiDiagnostics = correctedGeneration.diagnostics
      providerUsed = correctedGeneration.providerUsed
      filesCreated = aiResult.files.map(file => file.newPath || file.path)
      outputDiagnostics = getEasyCodeAiResultDiagnostics(aiResult, project)
      missingStarterFiles = outputDiagnostics.missingStarterFiles
      proposedReadiness = outputDiagnostics.readiness
      validationSummary = getEasyCodeValidationSummary(outputDiagnostics, true)

      console.info('[Easy Code] Corrected generation output validated', {
        projectId,
        phase: 'create',
        promptType,
        returnedFiles: aiResult.files.length,
        filesReturnedCount: aiResult.files.length,
        meaningfulAiOutput: proposedReadiness.hasIndexHtml && proposedReadiness.meaningfulFileCount > 0,
        validatedFiles: proposedReadiness.fileCount,
        validationRejectedCount: validationSummary.validationRejectedCount,
        validationRejectedReason: validationSummary.validationRejectedReason,
        meaningfulFiles: proposedReadiness.meaningfulFileCount,
        hasIndexHtml: proposedReadiness.hasIndexHtml,
        missingStarterFiles,
        readmeOnly: outputDiagnostics.readmeOnly,
        providerUsed,
      })
    }

    if (missingStarterFiles.length > 0) throw attachEasyCodeDiagnostics(new Error('Generation incomplete. Retry.'), aiDiagnostics)
    if (outputDiagnostics.readmeOnly) throw attachEasyCodeDiagnostics(new Error('Generation incomplete. Retry.'), aiDiagnostics)
    if (!proposedReadiness.ready) throw attachEasyCodeDiagnostics(new Error('Generation incomplete. Retry.'), aiDiagnostics)
    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'generating',
      phase: 'saving_files',
      metadata: withEasyCodeDiagnostics(
        buildEasyCodeProgress('saving_files', filesCreated, null, staticLandingPage ? 'static_site' : 'generic'),
        aiDiagnostics,
        providerUsed
      ),
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
      phase: 'create',
      promptType,
      savedFiles: savedFiles.length,
      filesSavedCount: savedFiles.length,
      meaningfulFiles: savedReadiness.meaningfulFileCount,
      hasIndexHtml: savedReadiness.hasIndexHtml,
      missingStarterFiles: missingSavedStarterFiles,
    })
    if (missingSavedStarterFiles.length > 0) throw attachEasyCodeDiagnostics(new Error('Generation incomplete. Retry.'), aiDiagnostics)
    if (!savedReadiness.ready) throw attachEasyCodeDiagnostics(new Error('Generation incomplete. Retry.'), aiDiagnostics)
    await db.from('easy_code_projects')
      .update({
        title: aiResult.title || project.title,
        framework: aiResult.framework || project.framework,
        generation_status: 'generating',
        generation_phase: 'building_preview',
        generation_metadata: withEasyCodeDiagnostics(
          buildEasyCodeProgress('building_preview', filesCreated, null, staticLandingPage ? 'static_site' : 'generic'),
          aiDiagnostics,
          providerUsed
        ),
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
        generationDiagnostics: {
          providerUsed,
          attempts: aiDiagnostics,
        },
      },
    })

    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'ready',
      phase: 'complete',
      error: null,
      metadata: withEasyCodeDiagnostics(
        buildEasyCodeProgress('complete', filesCreated, null, staticLandingPage ? 'static_site' : 'generic'),
        aiDiagnostics,
        providerUsed
      ),
      title: aiResult.title || project.title,
      framework: aiResult.framework || project.framework,
      lastGeneratedAt: new Date().toISOString(),
    })
    recordEasyCodeAiSuccess()

    const [freshProject, freshFiles, freshMessages] = await Promise.all([
      getEasyCodeProject(userId, projectId),
      getEasyCodeFiles(userId, projectId),
      getEasyCodeMessages(userId, projectId),
    ])
    console.info('[Easy Code] Generation completed', {
      projectId,
      phase: 'create',
      promptType,
      providerUsed,
      filesSavedCount: freshFiles.length,
      fallbackUsed: providerUsed !== 'azure-gpt54',
      finalStatus: 'ready',
    })
    return { project: freshProject, files: freshFiles, messages: freshMessages, aiResult, diagnostics: aiDiagnostics, providerUsed }
  } catch (error: any) {
    const message = getSafeEasyCodeError(error)
    const errorCategory = categorizeEasyCodeError(error)
    const errorDiagnostics: EasyCodeAiDiagnostics[] = Array.isArray(error?.easyCodeDiagnostics) ? error.easyCodeDiagnostics : []
    const allowStaticFallback = staticLandingPage && errorCategory !== 'save_failed'
    if (allowStaticFallback) {
      try {
        const db = await getDb()
        const fallbackReason = getEasyCodeFallbackSummaryLead(error)
        const fallbackResult = createGuaranteedStaticWebsiteFallback(cleanPrompt, inferStaticSiteTitle(cleanPrompt), fallbackReason)
        const fallbackFiles = fallbackResult.files.map(file => file.path)
        const fallbackDiagnostics = [
          ...errorDiagnostics,
          buildEasyCodeProviderDiagnostics('fallback', 'create', null, error, {
            fallbackUsed: true,
            safeReason: getEasyCodeSafeReason(error),
            timeoutHit: isTimeoutError(error),
            safeCode: 'static_fallback_used',
          }),
        ]
        recordEasyCodeFallbackUsage(fallbackResult.summary, 'static_fallback_used')

        console.warn('[Easy Code] Static fallback starting', {
          projectId,
          phase: 'create',
          promptType,
          timeoutHit: isTimeoutError(error),
          reason: message,
          fallbackUsed: true,
          errorCategory,
          diagnostics: fallbackDiagnostics,
        })

        await db
          .from('easy_code_files')
          .delete()
          .eq('project_id', projectId)
          .eq('user_id', userId)

        await updateEasyCodeGenerationState(userId, projectId, {
          status: 'generating',
          phase: 'saving_files',
          error: null,
          metadata: withEasyCodeDiagnostics(buildEasyCodeProgress('saving_files', fallbackFiles, null, 'static_site'), fallbackDiagnostics, 'fallback'),
        })
        await applyEasyCodeAiResult(userId, projectId, fallbackResult)
        const savedFiles = await getEasyCodeFiles(userId, projectId)
        const readiness = getEasyCodeReadiness(savedFiles, { ...project, framework: 'html' })
        const missingStarterFiles = getMissingStaticStarterFiles(savedFiles)
        const savedPaths = savedFiles.map((file) => file.path.toLowerCase())

        console.info('[Easy Code] Static fallback saved files', {
          projectId,
          phase: 'create',
          promptType,
          fallbackUsed: true,
          savedFiles: savedFiles.length,
          filesSavedCount: savedFiles.length,
          savedPaths,
          missingStarterFiles,
          previewAvailable: readiness.hasIndexHtml,
          ready: readiness.ready,
          providerUsed: 'fallback',
        })

        if (missingStarterFiles.length > 0 || !readiness.ready) {
          throw new Error('Could not save fallback files.')
        }

        await db.from('easy_code_messages').insert({
          project_id: projectId,
          user_id: userId,
          role: 'assistant',
          content: fallbackResult.summary,
          metadata: {
            instructions: fallbackResult.instructions,
            changedFiles: fallbackResult.files.map(file => ({ path: file.path, operation: file.operation })),
            previewType: fallbackResult.previewType,
            fallbackUsed: true,
            fallbackReason: message,
            generationDiagnostics: {
              providerUsed: 'fallback',
              attempts: fallbackDiagnostics,
            },
          },
        })

        await updateEasyCodeGenerationState(userId, projectId, {
          status: 'ready',
          phase: 'complete',
          error: null,
          metadata: {
            ...withEasyCodeDiagnostics(
              buildEasyCodeProgress('complete', fallbackFiles, null, 'static_site'),
              fallbackDiagnostics,
              'fallback'
            ),
            warning: fallbackResult.summary,
          },
          title: fallbackResult.title || project.title,
          framework: 'html',
          lastGeneratedAt: new Date().toISOString(),
        })

        const [freshProject, freshFiles, freshMessages] = await Promise.all([
          getEasyCodeProject(userId, projectId),
          getEasyCodeFiles(userId, projectId),
          getEasyCodeMessages(userId, projectId),
        ])
        console.info('[Easy Code] Status set ready after static fallback', {
          projectId,
          phase: 'create',
          promptType,
          fallbackUsed: true,
          savedFiles: freshFiles.length,
          zipFileCount: freshFiles.length,
          previewAvailable: freshFiles.some(file => file.path.toLowerCase() === 'index.html'),
          finalStatus: 'ready',
        })
        return { project: freshProject, files: freshFiles, messages: freshMessages, aiResult: fallbackResult, fallbackUsed: true, diagnostics: fallbackDiagnostics, providerUsed: 'fallback' }
      } catch (fallbackError: any) {
        console.error('[Easy Code] Static fallback failed', {
          projectId,
          message: fallbackError?.message,
          originalMessage: message,
          errorCategory,
          fallbackUsed: false,
        })
      }
    }
    const status = message === 'Generation incomplete. Retry.' ? 'incomplete' : 'failed'
    await updateEasyCodeGenerationState(userId, projectId, {
      status,
      phase: 'failed',
      error: message,
      metadata: withEasyCodeDiagnostics(buildEasyCodeProgress('failed', [], message), errorDiagnostics),
    }).catch(() => {})
    console.error('[Easy Code] Status updated to failed', {
      message,
      projectId,
      phase: 'create',
      promptType,
      timeoutHit: isTimeoutError(error),
      errorCategory,
      fallbackUsed: false,
      finalStatus: status,
      diagnostics: errorDiagnostics,
    })
    throw attachEasyCodeDiagnostics(new Error(message), errorDiagnostics)
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
}): Promise<EasyCodeGenerationPayload> {
  const staticLandingPage = input.mode === 'create' && isStaticLandingPageRequest(input.instruction)
  const staticProjectEdit = input.mode === 'edit' && (
    input.project.framework === 'html' ||
    input.files.some(file => file.path.toLowerCase() === 'index.html')
  )
  const promptType = staticLandingPage || staticProjectEdit
    ? 'static-site'
    : inferEasyCodePromptType(input.instruction, input.files)
  const fileTree = input.files.map(file => `${file.path} (${file.language || inferLanguage(file.path)}, ${file.size_bytes} bytes)`).join('\n') || 'No files yet.'
  const selectedFile = input.selectedPath
    ? input.files.find(file => file.path === input.selectedPath)
    : null
  const mentionedFiles = input.files.filter(file => input.instruction.toLowerCase().includes(file.path.toLowerCase()))
  const keyFiles = input.files.filter(file => /(^|\/)(package\.json|readme\.md|index\.html|styles\.css|script\.js|src\/app|src\/main|src\/App|app\/page)/i.test(file.path))
  const totalStaticFileBytes = input.files.reduce((sum, file) => sum + file.size_bytes, 0)
  const contextFiles = staticProjectEdit && (input.files.length <= 12 || totalStaticFileBytes <= 120_000)
    ? input.files
    : Array.from(new Map([
      ...(selectedFile ? [[selectedFile.path, selectedFile]] as Array<[string, EasyCodeFile]> : []),
      ...mentionedFiles.map(file => [file.path, file] as [string, EasyCodeFile]),
      ...keyFiles.map(file => [file.path, file] as [string, EasyCodeFile]),
    ]).values()).slice(0, 10)

  const fileContext = contextFiles.map(file => [
    `--- FILE: ${file.path}`,
    file.content.slice(0, 18000),
  ].join('\n')).join('\n\n')

  const recentMessages = staticLandingPage ? '' : input.messages.slice(-10).map(message => `${message.role}: ${message.content}`).join('\n')
  const system = getEasyCodeJsonSystemPrompt()

  const user = staticLandingPage
    ? `Mode: create
Project: ${input.project.title}
Description: ${input.project.description || ''}
Instruction: ${input.instruction}

Generate a premium static landing page. Return JSON only.
Requirements:
- framework must be "html"
- previewType must be "static-html"
- files must be exactly: index.html, styles.css, script.js, README.md
- index.html should link styles.css and script.js
- do not inline all CSS or JavaScript into index.html
- include a polished hero section, services, benefits, pricing, testimonials, FAQ, contact or booking CTA, and responsive mobile layout
- write professional business copy, not generic filler
- script.js should add safe polished interactions such as smooth scrolling, reveal-on-scroll, menu handling, and CTA feedback
- keep it visually premium and cohesive
- do not output markdown fences
- do not output README-only
- no broken links or external paid libraries`
    : input.mode === 'edit'
      ? `Mode: edit
Project: ${input.project.title}
Original description: ${input.project.description || ''}
User requested change: ${input.instruction}
Selected/open file: ${input.selectedPath || 'none'}

File tree:
${fileTree}

Recent Easy Code messages:
${recentMessages || 'None'}

Current relevant file contents:
${fileContext || 'None'}

Return JSON only.
Apply the requested change with minimal targeted operations.
If this is a static site:
- read all supplied files as the current source of truth
- improve the existing HTML/CSS/JS instead of rebuilding from scratch
- keep the site premium and coherent
- update the specific files needed, usually index.html, styles.css, and script.js
- preserve working sections unless the user asked to replace them
- do not return README only
- do not return zero operations`
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

  console.info('[Easy Code] AI generation prepared', {
    projectId: input.projectId || null,
    mode: input.mode,
    promptType,
    staticLandingPage,
    staticProjectEdit,
    contextFileCount: contextFiles.length,
  })
  const raw = await callEasyCodeJsonProvider([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], staticLandingPage ? 2600 : input.mode === 'create' ? 8000 : 7000, {
    timeoutMs: staticLandingPage ? EASY_CODE_CREATE_TIMEOUT_MS : input.mode === 'edit' ? EASY_CODE_EDIT_TIMEOUT_MS : EASY_CODE_CREATE_TIMEOUT_MS,
    phase: getEasyCodePhase(input.mode),
    projectId: input.projectId,
    promptType,
  })
  const parsed = await parseEasyCodeJson(raw.content, input.projectId, raw.diagnostics)
  return {
    aiResult: parsed.aiResult,
    diagnostics: parsed.diagnostics,
    providerUsed: raw.providerUsed,
  }
}

export async function applyEasyCodeAiResult(userId: string, projectId: string, aiResult: EasyCodeAiResult) {
  const db = await getDb()
  const existing = await getEasyCodeFiles(userId, projectId)
  const existingPaths = new Set(existing.map(file => file.path.toLowerCase()))
  if (aiResult.files.length === 0) {
    throw new Error('No valid file changes were returned. Try again.')
  }
  if (existing.length + aiResult.files.filter(file => file.operation === 'create').length > EASY_CODE_MAX_PROJECT_FILES) {
    throw new Error('This Easy Code project has reached the file limit.')
  }

  let savedFiles = 0
  let createdFiles = 0
  let updatedFiles = 0
  let deletedFiles = 0
  let renamedFiles = 0
  console.info('[Easy Code] Applying generated files', {
    projectId,
    returnedFiles: aiResult.files.length,
    existingFiles: existing.length,
  })
  for (const file of aiResult.files) {
    const path = validateEasyCodePath(file.path)
    if (file.operation === 'delete') {
      const { error } = await db.from('easy_code_files').delete().eq('project_id', projectId).eq('user_id', userId).eq('path', path)
      if (error) {
        console.error('[Easy Code] File delete failed', { projectId, path, code: error.code })
        throw new Error('Could not save updated files.')
      }
      deletedFiles += 1
      continue
    }
    if (file.operation === 'rename') {
      const newPath = validateEasyCodePath(file.newPath)
      const renameUpdate: Record<string, any> = {
        path: newPath,
        updated_at: new Date().toISOString(),
      }
      if (typeof file.content === 'string' && file.content.trim()) {
        if (bytesOf(file.content) > EASY_CODE_MAX_FILE_BYTES) throw new Error(`File is too large: ${newPath}`)
        renameUpdate.content = file.content
        renameUpdate.size_bytes = bytesOf(file.content)
        renameUpdate.language = file.language || inferLanguage(newPath)
      }
      const { error } = await db.from('easy_code_files')
        .update(renameUpdate)
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .eq('path', path)
      if (error) {
        console.error('[Easy Code] File rename failed', { projectId, path, newPath, code: error.code })
        throw new Error('Could not save updated files.')
      }
      renamedFiles += 1
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
    if (error) {
      console.error('[Easy Code] File upsert failed', { projectId, path, code: error.code })
      throw new Error('Could not save updated files.')
    }
    if (existingPaths.has(path.toLowerCase())) {
      updatedFiles += 1
    } else {
      createdFiles += 1
    }
    savedFiles += 1
  }
  console.info('[Easy Code] Applied generated files', {
    projectId,
    savedFiles,
    createdFiles,
    updatedFiles,
    deletedFiles,
    renamedFiles,
    finalStatus: 'ready',
  })
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
  const staticProjectEdit = project.framework === 'html' ||
    files.some(file => file.path.toLowerCase() === 'index.html')
  const promptType = staticProjectEdit ? 'static-site' : inferEasyCodePromptType(cleanInstruction, files)
  console.info('[Easy Code] Edit started', {
    projectId,
    existingFiles: files.length,
    selectedPath: selectedPath || null,
    promptType,
  })

  const db = await getDb()
  await db.from('easy_code_messages').insert({ project_id: projectId, user_id: userId, role: 'user', content: cleanInstruction })
  try {
    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'generating',
      phase: 'planning',
      error: null,
      metadata: buildEasyCodeProgress('planning', [], null, staticProjectEdit ? 'static_site' : 'generic'),
    })
    const generation = await generateEasyCodeFiles({
      mode: 'edit',
      project,
      files,
      messages,
      instruction: cleanInstruction,
      selectedPath,
      projectId,
    })
    const { aiResult, diagnostics: aiDiagnostics, providerUsed } = generation
    const editDiagnostics = getEasyCodeAiResultDiagnostics(aiResult, project)
    const validationSummary = getEasyCodeValidationSummary(editDiagnostics, false)
    if (editDiagnostics.readmeOnly || aiResult.files.length === 0) {
      console.warn('[Easy Code] Edit returned invalid operations', {
        projectId,
        promptType,
        operationsCount: aiResult.files.length,
        readmeOnly: editDiagnostics.readmeOnly,
        validationRejectedCount: validationSummary.validationRejectedCount,
        validationRejectedReason: validationSummary.validationRejectedReason,
        errorCategory: editDiagnostics.readmeOnly ? 'readme_only' : 'no_valid_changes',
      })
      throw new Error(editDiagnostics.readmeOnly
        ? 'The AI returned invalid file changes. Try again.'
        : 'No valid file changes were returned. Try again.')
    }
    console.info('[Easy Code] Edit model output parsed', {
      projectId,
      promptType,
      operationsCount: aiResult.files.length,
      filesReturnedCount: aiResult.files.length,
      validationRejectedCount: validationSummary.validationRejectedCount,
      validationRejectedReason: validationSummary.validationRejectedReason,
      providerUsed,
    })
    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'generating',
      phase: 'saving_files',
      error: null,
      metadata: withEasyCodeDiagnostics(
        buildEasyCodeProgress('saving_files', aiResult.files.map(file => file.newPath || file.path), null, staticProjectEdit ? 'static_site' : 'generic'),
        aiDiagnostics,
        providerUsed
      ),
    })
    await applyEasyCodeAiResult(userId, projectId, aiResult)
    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'generating',
      phase: 'building_preview',
      error: null,
      metadata: withEasyCodeDiagnostics(
        buildEasyCodeProgress('building_preview', aiResult.files.map(file => file.newPath || file.path), null, staticProjectEdit ? 'static_site' : 'generic'),
        aiDiagnostics,
        providerUsed
      ),
    })
    await db.from('easy_code_messages').insert({
      project_id: projectId,
      user_id: userId,
      role: 'assistant',
      content: aiResult.summary,
      metadata: {
        instructions: aiResult.instructions,
        changedFiles: aiResult.files.map(file => ({ path: file.newPath || file.path, operation: file.operation })),
        previewType: aiResult.previewType,
        generationDiagnostics: {
          providerUsed,
          attempts: aiDiagnostics,
        },
      },
    })
    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'ready',
      phase: 'complete',
      error: null,
      metadata: withEasyCodeDiagnostics(
        buildEasyCodeProgress('complete', aiResult.files.map(file => file.newPath || file.path), null, staticProjectEdit ? 'static_site' : 'generic'),
        aiDiagnostics,
        providerUsed
      ),
      title: aiResult.title || project.title,
      framework: aiResult.framework || project.framework,
      lastGeneratedAt: new Date().toISOString(),
    })
    recordEasyCodeAiSuccess()
    const [freshProject, freshFiles, freshMessages] = await Promise.all([
      getEasyCodeProject(userId, projectId),
      getEasyCodeFiles(userId, projectId),
      getEasyCodeMessages(userId, projectId),
    ])
    console.info('[Easy Code] Edit completed', {
      projectId,
      promptType,
      filesCount: freshFiles.length,
      filesSavedCount: aiResult.files.length,
      changedFiles: aiResult.files.map(file => file.newPath || file.path),
      finalStatus: 'ready',
      fallbackUsed: providerUsed !== 'azure-gpt54',
    })
    return { project: freshProject, files: freshFiles, messages: freshMessages, aiResult, diagnostics: aiDiagnostics, providerUsed }
  } catch (error: any) {
    const errorDiagnostics: EasyCodeAiDiagnostics[] = Array.isArray(error?.easyCodeDiagnostics) ? error.easyCodeDiagnostics : []
    const safeReason = getEasyCodeSafeReason(error)
    const message = safeReason === 'timed out'
      ? 'timed out'
      : safeReason === 'provider not configured'
        ? 'provider not configured'
        : safeReason === 'invalid credentials'
          ? 'invalid credentials'
          : safeReason === 'deployment not found'
            ? 'deployment not found'
            : safeReason === 'provider busy'
              ? 'provider busy'
              : safeReason === 'invalid JSON'
                ? 'invalid JSON'
                : error?.message === 'No valid file changes were returned. Try again.' || error?.message === 'The AI returned invalid file changes. Try again.' || error?.message === 'Could not save updated files.'
                  ? error.message
                  : 'Could not apply changes right now.'
    await updateEasyCodeGenerationState(userId, projectId, {
      status: 'ready',
      phase: 'complete',
      error: message,
      metadata: withEasyCodeDiagnostics(
        buildEasyCodeProgress('complete', files.map(file => file.path), message, staticProjectEdit ? 'static_site' : 'generic'),
        errorDiagnostics
      ),
      lastGeneratedAt: project.last_generated_at || null,
    }).catch(() => {})
    console.error('[Easy Code] Edit failed', {
      projectId,
      promptType,
      message,
      timeoutHit: isTimeoutError(error),
      errorCategory: categorizeEasyCodeError(error),
      fallbackUsed: false,
      existingFilesPreserved: true,
      finalStatus: 'ready',
      diagnostics: errorDiagnostics,
    })
    throw attachEasyCodeDiagnostics(new Error(message), errorDiagnostics)
  }
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
