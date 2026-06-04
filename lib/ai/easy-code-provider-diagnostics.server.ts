import 'server-only'

import { getServerEnvStatus, readServerEnv } from '@/lib/server-env'

type EasyCodeTrackedProvider = 'gpt54' | 'deepseek'

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
        apiKey: 'AZURE_GPT54_API_KEY',
        baseUrl: 'AZURE_GPT54_BASE_URL',
        model: 'AZURE_GPT54_MODEL',
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

export function getCurrentEasyCodeProviderEnvDiagnostics(provider: EasyCodeTrackedProvider) {
  const names = getProviderEnvNames(provider)
  const apiKey = readServerEnv(names.apiKey)
  const baseUrl = normalizeBaseUrl(provider, readServerEnv(names.baseUrl))
  const configuredModel = readServerEnv(names.model)
  const model = configuredModel || names.defaultModel
  const endpoint = getEndpointMetadata(baseUrl)
  return {
    envExists: {
      apiKey: getServerEnvStatus(names.apiKey).exists,
      baseUrl: getServerEnvStatus(names.baseUrl).exists,
      model: getServerEnvStatus(names.model).exists,
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
  return {
    easyCodeProvider: {
      gpt54Configured: gpt54.envConfigured,
      apiKeyConfigured: gpt54.apiKeyConfigured,
      baseUrlConfigured: gpt54.baseUrlConfigured,
      modelConfigured: gpt54.modelConfigured,
      endpointHost: gpt54.endpointHost,
      endpointPath: gpt54.endpointPath,
      model: gpt54.model,
      lastStatus: lastAttempts.gpt54?.statusCode ?? null,
      lastSafeReason: lastAttempts.gpt54?.safeReason ?? null,
      lastSafeCode: lastAttempts.gpt54?.safeCode ?? null,
      lastAttemptAt: lastAttempts.gpt54?.attemptedAt ?? null,
      fallbackUsed: lastFallback.fallbackUsed,
      envExists: gpt54.envExists,
      envValueLengths: gpt54.envValueLengths,
      finalRequestPath: gpt54.finalRequestPath,
      responseFormatUsed: lastAttempts.gpt54?.responseFormatUsed ?? false,
      providerErrorCode: lastAttempts.gpt54?.providerErrorCode ?? null,
      providerErrorMessage: lastAttempts.gpt54?.providerErrorMessage ?? null,
      deepseekFallbackAttempt: lastAttempts.deepseek,
      fallback: lastFallback,
    },
  }
}
