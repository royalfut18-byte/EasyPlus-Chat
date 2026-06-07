import 'server-only'

import {
  AZURE_GPT54_API_KEY_ENV_PRIORITY,
  AZURE_GPT54_BASE_URL_ENV_PRIORITY,
  AZURE_GPT54_MODEL_ENV_PRIORITY,
  getAzureGpt54ResolvedEnvDiagnostics,
} from '@/lib/ai/azure-gpt54.server'
import { getServerEnvStatus, readServerEnv } from '@/lib/server-env'

type EasyCodeTrackedProvider = 'gpt54' | 'deepseek'

type EasyCodeEnvValueStatus = 'missing' | 'blank_or_whitespace' | 'quoted_blank' | 'configured'

export interface EasyCodeProviderAttemptDiagnostics {
  provider: EasyCodeTrackedProvider
  phase: 'create' | 'edit' | 'repair'
  attemptedAt: string
  envExists: {
    apiKey: boolean
    baseUrl: boolean
    model: boolean
  }
  envConfigured: boolean
  envValueLengths: {
    apiKey: number
    baseUrl: number
    model: number
  }
  endpointHost: string | null
  endpointPath: string | null
  finalRequestPath: string | null
  model: string | null
  statusCode: number | null
  providerErrorCode: string | null
  providerErrorMessage: string | null
  responseFormatUsed: boolean
  timeoutHit: boolean
  fallbackUsed: boolean
  safeReason: string
  safeCode: string
}

type EasyCodeFallbackDiagnostics = {
  attemptedAt: string | null
  safeReason: string | null
  safeCode: string | null
  fallbackUsed: boolean
}

const lastAttempts: Record<EasyCodeTrackedProvider, EasyCodeProviderAttemptDiagnostics | null> = {
  gpt54: null,
  deepseek: null,
}

let lastFallback: EasyCodeFallbackDiagnostics = {
  attemptedAt: null,
  safeReason: null,
  safeCode: null,
  fallbackUsed: false,
}

function getProviderEnvNames(provider: EasyCodeTrackedProvider) {
  return provider === 'gpt54'
    ? {
        apiKey: [...AZURE_GPT54_API_KEY_ENV_PRIORITY],
        baseUrl: [...AZURE_GPT54_BASE_URL_ENV_PRIORITY],
        model: [...AZURE_GPT54_MODEL_ENV_PRIORITY],
        defaultModel: 'gpt-5.4',
      }
    : {
        apiKey: 'AZURE_DEEPSEEK_API_KEY',
        baseUrl: 'AZURE_DEEPSEEK_BASE_URL',
        model: 'AZURE_DEEPSEEK_MODEL',
        defaultModel: 'DeepSeek-V4-Pro',
      }
}

function normalizeBaseUrl(provider: EasyCodeTrackedProvider, baseUrl?: string) {
  if (!baseUrl) return undefined
  return provider === 'gpt54'
    ? baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')
    : baseUrl.trim().replace(/\/+$/, '')
}

function getEndpointMetadata(baseUrl?: string) {
  if (!baseUrl) return { endpointHost: null, endpointPath: '/chat/completions', finalRequestPath: '/chat/completions' }
  try {
    const url = new URL(`${baseUrl}/chat/completions`)
    return {
      endpointHost: url.hostname,
      endpointPath: url.pathname,
      finalRequestPath: `${url.pathname}${url.search || ''}`,
    }
  } catch {
    return { endpointHost: null, endpointPath: '/chat/completions', finalRequestPath: '/chat/completions' }
  }
}

function getSingleEnvValueStatus(name: string): EasyCodeEnvValueStatus {
  if (!Object.prototype.hasOwnProperty.call(process.env, name)) return 'missing'
  const raw = process.env[name]
  if (raw == null || raw.trim().length === 0) return 'blank_or_whitespace'

  let normalized = raw.trim()
  for (let i = 0; i < 2; i += 1) {
    if (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
      normalized = normalized.slice(1, -1).trim()
    }
  }

  return normalized ? 'configured' : 'quoted_blank'
}

function getEnvValueStatus(names: string | string[]): EasyCodeEnvValueStatus {
  const candidates = (Array.isArray(names) ? names : [names]).map(getSingleEnvValueStatus)
  if (candidates.includes('configured')) return 'configured'
  if (candidates.includes('quoted_blank')) return 'quoted_blank'
  if (candidates.includes('blank_or_whitespace')) return 'blank_or_whitespace'
  return 'missing'
}

function getLastEasyCodeAttemptSummary() {
  const candidates = [
    lastAttempts.gpt54
      ? {
          provider: 'gpt54' as const,
          attemptedAt: lastAttempts.gpt54.attemptedAt,
          status: lastAttempts.gpt54.statusCode === 200 ? 'succeeded' : 'failed',
          safeReason: lastAttempts.gpt54.safeReason,
          fallbackUsed: lastAttempts.gpt54.fallbackUsed,
        }
      : null,
    lastAttempts.deepseek
      ? {
          provider: 'deepseek' as const,
          attemptedAt: lastAttempts.deepseek.attemptedAt,
          status: lastAttempts.deepseek.statusCode === 200 ? 'succeeded' : 'failed',
          safeReason: lastAttempts.deepseek.safeReason,
          fallbackUsed: lastAttempts.deepseek.fallbackUsed,
        }
      : null,
    lastFallback.attemptedAt
      ? {
          provider: 'fallback' as const,
          attemptedAt: lastFallback.attemptedAt,
          status: lastFallback.fallbackUsed ? 'fallback' : 'succeeded',
          safeReason: lastFallback.safeReason || null,
          fallbackUsed: lastFallback.fallbackUsed,
        }
      : null,
  ].filter(Boolean)

  if (candidates.length === 0) {
    return {
      provider: null,
      status: null,
      safeReason: null,
      fallbackUsed: false,
      attemptedAt: null,
    }
  }

  candidates.sort((a, b) => Date.parse(b!.attemptedAt) - Date.parse(a!.attemptedAt))
  const latest = candidates[0]!
  return {
    provider: latest.provider,
    status: latest.status,
    safeReason: latest.safeReason,
    fallbackUsed: latest.fallbackUsed,
    attemptedAt: latest.attemptedAt,
  }
}

export function getCurrentEasyCodeProviderEnvDiagnostics(provider: EasyCodeTrackedProvider) {
  const names = getProviderEnvNames(provider)
  if (provider === 'gpt54') {
    const resolved = getAzureGpt54ResolvedEnvDiagnostics()
    const endpoint = getEndpointMetadata(resolved.baseUrl)
    const apiKeyNames = [...AZURE_GPT54_API_KEY_ENV_PRIORITY]
    const baseUrlNames = [...AZURE_GPT54_BASE_URL_ENV_PRIORITY]
    const modelNames = [...AZURE_GPT54_MODEL_ENV_PRIORITY]
    return {
      envExists: {
        apiKey: apiKeyNames.some((name) => getServerEnvStatus(name).exists),
        baseUrl: baseUrlNames.some((name) => getServerEnvStatus(name).exists),
        model: modelNames.some((name) => getServerEnvStatus(name).exists),
      },
      envValueStatus: {
        apiKey: getEnvValueStatus(apiKeyNames),
        baseUrl: getEnvValueStatus(baseUrlNames),
        model: getEnvValueStatus(modelNames),
      },
      envConfigured: Boolean(resolved.apiKey && resolved.baseUrl && resolved.configuredModel),
      envValueLengths: {
        apiKey: resolved.apiKey?.length || 0,
        baseUrl: resolved.baseUrl?.length || 0,
        model: resolved.configuredModel?.length || 0,
      },
      endpointHost: endpoint.endpointHost,
      endpointPath: endpoint.endpointPath,
      finalRequestPath: endpoint.finalRequestPath,
      model: resolved.model,
      apiKeyConfigured: resolved.apiKeyConfigured,
      baseUrlConfigured: resolved.baseUrlConfigured,
      modelConfigured: resolved.modelConfigured,
      apiKeySource: resolved.apiKeySource,
      baseUrlSource: resolved.baseUrlSource,
      modelSource: resolved.modelSource,
    }
  }

  const apiKeyName = 'AZURE_DEEPSEEK_API_KEY'
  const baseUrlName = 'AZURE_DEEPSEEK_BASE_URL'
  const modelName = 'AZURE_DEEPSEEK_MODEL'
  const apiKey = readServerEnv(apiKeyName)
  const baseUrl = normalizeBaseUrl(provider, readServerEnv(baseUrlName))
  const configuredModel = readServerEnv(modelName)
  const model = configuredModel || names.defaultModel
  const endpoint = getEndpointMetadata(baseUrl)
  return {
    envExists: {
      apiKey: getServerEnvStatus(apiKeyName).exists,
      baseUrl: getServerEnvStatus(baseUrlName).exists,
      model: getServerEnvStatus(modelName).exists,
    },
    envValueStatus: {
      apiKey: getEnvValueStatus(apiKeyName),
      baseUrl: getEnvValueStatus(baseUrlName),
      model: getEnvValueStatus(modelName),
    },
    envConfigured: Boolean(apiKey && baseUrl && configuredModel),
    envValueLengths: {
      apiKey: apiKey?.length || 0,
      baseUrl: baseUrl?.length || 0,
      model: configuredModel?.length || 0,
    },
    endpointHost: endpoint.endpointHost,
    endpointPath: endpoint.endpointPath,
    finalRequestPath: endpoint.finalRequestPath,
    model,
    apiKeyConfigured: Boolean(apiKey),
    baseUrlConfigured: Boolean(baseUrl),
    modelConfigured: Boolean(configuredModel),
    apiKeySource: apiKeyName,
    baseUrlSource: baseUrlName,
    modelSource: modelName,
  }
}

export function recordEasyCodeProviderAttempt(
  attempt: Omit<EasyCodeProviderAttemptDiagnostics, 'envExists' | 'envConfigured' | 'envValueLengths'>
) {
  const env = getCurrentEasyCodeProviderEnvDiagnostics(attempt.provider)
  lastAttempts[attempt.provider] = {
    ...attempt,
    envExists: env.envExists,
    envConfigured: env.envConfigured,
    envValueLengths: env.envValueLengths,
    endpointHost: attempt.endpointHost ?? env.endpointHost,
    endpointPath: attempt.endpointPath ?? env.endpointPath,
    finalRequestPath: attempt.finalRequestPath ?? env.finalRequestPath,
    model: attempt.model ?? env.model,
  }
}

export function recordEasyCodeFallbackUsage(safeReason: string, safeCode: string) {
  lastFallback = {
    attemptedAt: new Date().toISOString(),
    safeReason,
    safeCode,
    fallbackUsed: true,
  }
}

export function recordEasyCodeAiSuccess() {
  lastFallback = {
    attemptedAt: new Date().toISOString(),
    safeReason: 'AI generation succeeded',
    safeCode: 'ai_generation_succeeded',
    fallbackUsed: false,
  }
}

export function getEasyCodeProviderDiagnosticsSummary() {
  const gpt54 = getCurrentEasyCodeProviderEnvDiagnostics('gpt54')
  const deepseek = getCurrentEasyCodeProviderEnvDiagnostics('deepseek')
  const lastAttempt = getLastEasyCodeAttemptSummary()
  return {
    easyCodeProvider: {
      gpt54Configured: gpt54.envConfigured,
      apiKeyConfigured: gpt54.apiKeyConfigured,
      baseUrlConfigured: gpt54.baseUrlConfigured,
      modelConfigured: gpt54.modelConfigured,
      endpointHost: gpt54.endpointHost,
      endpointPath: gpt54.endpointPath,
      model: gpt54.model,
      apiKeySource: gpt54.apiKeySource,
      baseUrlSource: gpt54.baseUrlSource,
      modelSource: gpt54.modelSource,
      lastStatus: lastAttempts.gpt54?.statusCode ?? null,
      lastSafeReason: lastAttempts.gpt54?.safeReason ?? null,
      lastSafeCode: lastAttempts.gpt54?.safeCode ?? null,
      lastAttemptAt: lastAttempts.gpt54?.attemptedAt ?? null,
      fallbackUsed: lastFallback.fallbackUsed,
      envExists: gpt54.envExists,
      envValueStatus: gpt54.envValueStatus,
      envValueLengths: gpt54.envValueLengths,
      finalRequestPath: gpt54.finalRequestPath,
      responseFormatUsed: lastAttempts.gpt54?.responseFormatUsed ?? false,
      providerErrorCode: lastAttempts.gpt54?.providerErrorCode ?? null,
      providerErrorMessage: lastAttempts.gpt54?.providerErrorMessage ?? null,
      deepseekFallbackAttempt: lastAttempts.deepseek,
      fallback: lastFallback,
      deepseekConfigured: deepseek.envConfigured,
      deepseekEnvExists: deepseek.envExists,
      deepseekEnvValueStatus: deepseek.envValueStatus,
      deepseekEnvValueLengths: deepseek.envValueLengths,
      lastEasyCodeProvider: lastAttempt.provider,
      lastEasyCodeStatus: lastAttempt.status,
      lastEasyCodeSafeReason: lastAttempt.safeReason,
      lastEasyCodeFallbackUsed: lastAttempt.fallbackUsed,
      lastEasyCodeAttemptAt: lastAttempt.attemptedAt,
    },
  }
}
