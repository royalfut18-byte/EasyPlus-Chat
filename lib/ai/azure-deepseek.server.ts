import 'server-only'

import type { ChatMessage } from '@/types/models'
import { getServerEnvStatus, readServerEnv } from '@/lib/server-env'
import {
  AzureTextProviderError,
  type AzureTextProviderConfigSnapshot,
} from '@/lib/ai/azure-provider-error'

const DEFAULT_AZURE_DEEPSEEK_MODEL = 'DeepSeek-V4-Pro'
const REQUEST_TIMEOUT_MS = 120_000
const FIRST_TOKEN_TIMEOUT_MS = 45_000
const AVAILABILITY_CACHE_MS = 5 * 60_000

export interface AzureDeepSeekDiagnostics {
  configured: boolean
  apiKeyConfigured: boolean
  baseUrlConfigured: boolean
  modelConfigured: boolean
  probeOk: boolean
  status: number | null
  endpointHost: string | null
  endpointPath: '/openai/v1/chat/completions' | string
  lastProbeAt: string
  envStatus: {
    apiKey: { exists: boolean; configured: boolean }
    baseUrl: { exists: boolean; configured: boolean }
    model: { exists: boolean; configured: boolean }
  }
  safeReason: string
}

let availabilityCache: { checkedAt: number; diagnostics: AzureDeepSeekDiagnostics } | null = null

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function getProviderConfig() {
  const apiKey = readServerEnv('AZURE_DEEPSEEK_API_KEY')
  const baseUrl = readServerEnv('AZURE_DEEPSEEK_BASE_URL')
  const configuredModel = readServerEnv('AZURE_DEEPSEEK_MODEL')
  const model = configuredModel || DEFAULT_AZURE_DEEPSEEK_MODEL
  const apiKeyEnv = getServerEnvStatus('AZURE_DEEPSEEK_API_KEY')
  const baseUrlEnv = getServerEnvStatus('AZURE_DEEPSEEK_BASE_URL')
  const modelEnv = getServerEnvStatus('AZURE_DEEPSEEK_MODEL')

  return {
    apiKey,
    baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : undefined,
    apiKeyConfigured: Boolean(apiKey),
    baseUrlConfigured: Boolean(baseUrl),
    model,
    modelConfigured: Boolean(configuredModel),
    envStatus: {
      apiKey: apiKeyEnv,
      baseUrl: baseUrlEnv,
      model: modelEnv,
    },
  }
}

export function getAzureDeepSeekConfigSnapshot(): AzureTextProviderConfigSnapshot {
  const { model, apiKeyConfigured, baseUrlConfigured, modelConfigured, envStatus, baseUrl } = getProviderConfig()
  const endpoint = getEndpointMetadata(baseUrl)
  return {
    provider: 'azure-deepseek',
    apiKeyConfigured,
    baseUrlConfigured,
    modelConfigured,
    ...endpoint,
    model,
    envStatus,
  }
}

function getSafeProviderError(status?: number): Error {
  if (status === 429 || (status != null && status >= 500)) {
    return new Error('DeepSeek V4 Pro is temporarily busy. Please try again in a moment.')
  }
  return new Error('DeepSeek V4 Pro is temporarily unavailable.')
}

function getSafeTimeoutError(): Error {
  return new Error('DeepSeek V4 Pro is taking too long to respond. Please try again.')
}

function getSafeConfigurationError(): Error {
  return new Error('DeepSeek V4 Pro is not configured.')
}

type AuthMode = 'api-key' | 'bearer'

function getHeaders(apiKey: string, authMode: AuthMode): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(authMode === 'api-key'
      ? { 'api-key': apiKey }
      : { Authorization: `Bearer ${apiKey}` }),
  }
}

function toProviderError(
  error: Error,
  snapshot: AzureTextProviderConfigSnapshot,
  status?: number | null,
  timeoutHit = false
): AzureTextProviderError {
  return new AzureTextProviderError(error.message, {
    provider: 'azure-deepseek',
    status,
    timeoutHit,
    safeReason: error.message,
    endpointHost: snapshot.endpointHost,
    endpointPath: snapshot.endpointPath,
    model: snapshot.model,
    envStatus: snapshot.envStatus,
    envConfigured: snapshot.envStatus.apiKey.configured &&
      snapshot.envStatus.baseUrl.configured &&
      snapshot.envStatus.model.configured,
  })
}

function getChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl}/chat/completions`
}

function getEndpointMetadata(baseUrl?: string): { endpointHost: string | null; endpointPath: string } {
  if (!baseUrl) return { endpointHost: null, endpointPath: '/chat/completions' }
  try {
    const url = new URL(getChatCompletionsUrl(baseUrl))
    return { endpointHost: url.hostname, endpointPath: url.pathname }
  } catch {
    return { endpointHost: null, endpointPath: '/chat/completions' }
  }
}

async function fetchWithAuthFallback(
  url: string,
  apiKey: string,
  init: Omit<RequestInit, 'headers'>
): Promise<{ response: Response; authMode: AuthMode }> {
  let authMode: AuthMode = 'api-key'
  let response = await fetch(url, { ...init, headers: getHeaders(apiKey, authMode) })
  if (response.status !== 401 && response.status !== 403) return { response, authMode }

  await response.body?.cancel().catch(() => {})
  authMode = 'bearer'
  console.warn('[Azure DeepSeek] Retrying with alternate server-side auth header', {
    firstStatus: response.status,
    authMode,
  })
  response = await fetch(url, { ...init, headers: getHeaders(apiKey, authMode) })
  return { response, authMode }
}

export async function getAzureDeepSeekDiagnostics(force = false): Promise<AzureDeepSeekDiagnostics> {
  const now = Date.now()
  const lastProbeAt = new Date(now).toISOString()
  if (!force && availabilityCache && now - availabilityCache.checkedAt < AVAILABILITY_CACHE_MS) {
    return availabilityCache.diagnostics
  }

  const { apiKey, baseUrl, model, apiKeyConfigured, baseUrlConfigured, modelConfigured, envStatus } = getProviderConfig()
  const endpoint = getEndpointMetadata(baseUrl)
  if (!apiKey || !baseUrl) {
    const diagnostics = {
      configured: Boolean(apiKey && baseUrl && model),
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      probeOk: false,
      status: null,
      ...endpoint,
      lastProbeAt,
      envStatus,
      safeReason: !apiKey
        ? 'Missing Azure API key configuration'
        : !baseUrl
          ? 'Missing Azure base URL configuration'
          : 'Missing Azure model configuration',
    }
    console.error('[Azure DeepSeek] Missing provider configuration', {
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      envStatus,
      ...endpoint,
      model,
    })
    availabilityCache = { checkedAt: now, diagnostics }
    return diagnostics
  }

  try {
    const { response, authMode } = await fetchWithAuthFallback(getChatCompletionsUrl(baseUrl), apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0,
        max_tokens: 8,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const diagnostics = {
        configured: true,
        apiKeyConfigured,
        baseUrlConfigured,
        modelConfigured,
        probeOk: false,
        status: response.status,
        ...endpoint,
        lastProbeAt,
        envStatus,
        safeReason: response.status === 401 || response.status === 403
          ? 'Invalid Azure key or unauthorized deployment'
          : response.status === 404
            ? 'Azure deployment/model endpoint not found'
            : response.status === 429
              ? 'Azure provider is busy'
              : 'Azure provider request failed',
      }
      console.error('[Azure DeepSeek] Availability probe failed', {
        status: response.status,
        authMode,
        baseUrlConfigured,
        modelConfigured,
        ...endpoint,
        model,
        envStatus,
      })
      availabilityCache = { checkedAt: now, diagnostics }
      return diagnostics
    }

    const data = await response.json().catch(() => null)
    const content = data?.choices?.[0]?.message?.content
    const available = typeof content === 'string' && content.trim().length > 0
    const diagnostics = {
      configured: true,
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      probeOk: available,
      status: response.status,
      ...endpoint,
      lastProbeAt,
      envStatus,
      safeReason: available ? 'Available' : 'Azure provider returned no content',
    }
    console.info('[Azure DeepSeek] Availability probe completed', {
      probeOk: available,
      status: response.status,
      authMode,
      baseUrlConfigured,
      modelConfigured,
      ...endpoint,
      model,
      envStatus,
    })
    availabilityCache = { checkedAt: now, diagnostics }
  } catch (error: any) {
    const diagnostics = {
      configured: true,
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      probeOk: false,
      status: null,
      ...endpoint,
      lastProbeAt,
      envStatus,
      safeReason: error?.name === 'TimeoutError' ? 'Azure provider probe timed out' : 'Azure provider is unreachable',
    }
    console.error('[Azure DeepSeek] Availability probe exception', {
      message: error.message,
      timeoutHit: error?.name === 'TimeoutError',
      baseUrlConfigured,
      modelConfigured,
      ...endpoint,
      model,
      envStatus,
    })
    availabilityCache = { checkedAt: now, diagnostics }
  }

  return availabilityCache.diagnostics
}

export async function isAzureDeepSeekAvailable(): Promise<boolean> {
  return (await getAzureDeepSeekDiagnostics()).probeOk
}

export async function streamAzureDeepSeekResponse(
  messages: ChatMessage[],
  systemPromptText: string,
  temperature: number = 0.7,
  maxTokens: number = 4096
): Promise<ReadableStream> {
  const { apiKey, baseUrl, model, apiKeyConfigured, baseUrlConfigured, modelConfigured, envStatus } = getProviderConfig()
  const endpoint = getEndpointMetadata(baseUrl)
  const snapshot = getAzureDeepSeekConfigSnapshot()

  if (!apiKey || !baseUrl) {
    console.error('[Azure DeepSeek] Missing provider configuration', {
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      envStatus,
      ...endpoint,
      model,
    })
    throw toProviderError(getSafeConfigurationError(), snapshot)
  }

  const controller = new AbortController()
  const totalTimeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const { response, authMode } = await fetchWithAuthFallback(getChatCompletionsUrl(baseUrl), apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPromptText },
          ...messages
            .filter((message) => message.role === 'user' || message.role === 'assistant')
            .map((message) => ({ role: message.role, content: message.content || '' })),
        ],
        temperature,
        max_tokens: Math.min(maxTokens, 4096),
        stream: true,
      }),
      signal: controller.signal,
    })

    if (!response.ok || !response.body) {
      console.error('[Azure DeepSeek] Request failed', {
        status: response.status,
        authMode,
        baseUrlConfigured,
        modelConfigured,
        ...endpoint,
        model,
      })
      throw toProviderError(getSafeProviderError(response.status), snapshot, response.status)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    return new ReadableStream({
      async start(streamController) {
        let buffer = ''
        let contentStarted = false
        let firstTokenTimeoutHit = false
        const firstTokenTimeout = setTimeout(() => {
          firstTokenTimeoutHit = true
          controller.abort()
        }, FIRST_TOKEN_TIMEOUT_MS)

        console.info('[Azure DeepSeek] Stream opened', {
          streamStarted: true,
          baseUrlConfigured,
          modelConfigured,
        })

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split(/\r?\n/)
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data:')) continue
              const payload = line.slice(5).trim()
              if (!payload || payload === '[DONE]') continue

              try {
                const data = JSON.parse(payload)
                const text = data?.choices?.[0]?.delta?.content
                if (typeof text === 'string' && text) {
                  if (!contentStarted) {
                    contentStarted = true
                    clearTimeout(firstTokenTimeout)
                    console.info('[Azure DeepSeek] First token received', {
                      streamStarted: true,
                      timeoutHit: false,
                    })
                  }
                  streamController.enqueue(encoder.encode(text))
                }
              } catch {
                console.warn('[Azure DeepSeek] Ignored malformed stream event')
              }
            }
          }

          if (!contentStarted) {
            console.error('[Azure DeepSeek] Stream closed without content', {
              streamStarted: true,
              timeoutHit: false,
            })
            throw getSafeProviderError()
          }

          streamController.close()
        } catch (error: any) {
          console.error('[Azure DeepSeek] Stream failed', {
            message: error.message,
            streamStarted: true,
            timeoutHit: firstTokenTimeoutHit,
          })
          streamController.error(firstTokenTimeoutHit ? getSafeTimeoutError() : getSafeProviderError())
        } finally {
          clearTimeout(firstTokenTimeout)
          clearTimeout(totalTimeout)
          reader.releaseLock()
        }
      },
      cancel() {
        clearTimeout(totalTimeout)
        controller.abort()
        reader.cancel().catch(() => {})
      },
    })
  } catch (error: any) {
    clearTimeout(totalTimeout)
    if (error?.message?.startsWith('DeepSeek V4 Pro')) throw error
    const timeoutHit = error?.name === 'AbortError' || error?.name === 'TimeoutError'
    console.error('[Azure DeepSeek] Request exception', {
      message: error.message,
      timeoutHit,
      streamStarted: false,
    })
    throw toProviderError(timeoutHit ? getSafeTimeoutError() : getSafeProviderError(), snapshot, null, timeoutHit)
  }
}

export async function generateAzureDeepSeekJson(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: {
    maxTokens?: number
    temperature?: number
    timeoutMs?: number
    phase?: string
    projectId?: string
  } = {}
): Promise<string> {
  const {
    apiKey,
    baseUrl,
    model,
    apiKeyConfigured,
    baseUrlConfigured,
    modelConfigured,
    envStatus,
  } = getProviderConfig()
  const endpoint = getEndpointMetadata(baseUrl)
  const snapshot = getAzureDeepSeekConfigSnapshot()

  if (!apiKey || !baseUrl) {
    console.error('[Azure DeepSeek] Missing provider configuration', {
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      envStatus,
      ...endpoint,
      model,
      phase: options.phase || 'json_generation',
      projectId: options.projectId || null,
    })
    throw toProviderError(getSafeConfigurationError(), snapshot)
  }

  const maxTokens = Math.min(options.maxTokens ?? 8192, 8192)
  const temperature = options.temperature ?? 0.2
  const timeoutMs = options.timeoutMs ?? 60_000
  const startedAt = Date.now()

  console.info('[Azure DeepSeek] JSON request started', {
    projectId: options.projectId || null,
    phase: options.phase || 'json_generation',
    maxTokens,
    timeoutMs,
    temperature,
  })

  let response: Response
  let authMode: AuthMode = 'api-key'

  try {
    const result = await fetchWithAuthFallback(getChatCompletionsUrl(baseUrl), apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    response = result.response
    authMode = result.authMode
  } catch (error: any) {
    const timeoutHit = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    console.error('[Azure DeepSeek] JSON request failed before response', {
      message: error?.message,
      timeoutHit,
      projectId: options.projectId || null,
      phase: options.phase || 'json_generation',
      durationMs: Date.now() - startedAt,
    })
    if (error instanceof AzureTextProviderError) throw error
    if (error?.message?.startsWith('DeepSeek V4 Pro')) {
      throw toProviderError(error, snapshot, null, timeoutHit)
    }
    throw toProviderError(timeoutHit ? getSafeTimeoutError() : getSafeProviderError(), snapshot, null, timeoutHit)
  }

  if (!response.ok) {
    console.error('[Azure DeepSeek] JSON request failed', {
      status: response.status,
      authMode,
      projectId: options.projectId || null,
      phase: options.phase || 'json_generation',
      durationMs: Date.now() - startedAt,
    })
    throw toProviderError(getSafeProviderError(response.status), snapshot, response.status)
  }

  const data = await response.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content
  const normalized = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => part?.text || '').join('')
      : ''

  if (!normalized.trim()) {
    console.error('[Azure DeepSeek] JSON request returned empty content', {
      projectId: options.projectId || null,
      phase: options.phase || 'json_generation',
      durationMs: Date.now() - startedAt,
    })
    throw new Error('The AI returned invalid file changes. Try again.')
  }

  console.info('[Azure DeepSeek] JSON request ended', {
    projectId: options.projectId || null,
    phase: options.phase || 'json_generation',
    durationMs: Date.now() - startedAt,
    responseChars: normalized.length,
    authMode,
  })

  return normalized
}
