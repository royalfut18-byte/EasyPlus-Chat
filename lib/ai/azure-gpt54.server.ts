import 'server-only'

import type { ChatAttachment, ChatMessage } from '@/types/models'
import { getServerEnvStatus, readServerEnv } from '@/lib/server-env'

const DEFAULT_AZURE_GPT54_MODEL = 'gpt-5.4'
const REQUEST_TIMEOUT_MS = 120_000
const FIRST_TOKEN_TIMEOUT_MS = 45_000
const AVAILABILITY_CACHE_MS = 5 * 60_000

type AuthMode = 'api-key' | 'bearer'
type AzureChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >
}

export interface AzureGpt54Diagnostics {
  configured: boolean
  apiKeyConfigured: boolean
  baseUrlConfigured: boolean
  modelConfigured: boolean
  probeOk: boolean
  status: number | null
  endpointHost: string | null
  endpointPath: string
  model: string
  lastProbeAt: string
  envStatus: {
    apiKey: { exists: boolean; configured: boolean }
    baseUrl: { exists: boolean; configured: boolean }
    model: { exists: boolean; configured: boolean }
  }
  safeReason: string
}

let availabilityCache: { checkedAt: number; diagnostics: AzureGpt54Diagnostics } | null = null

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
}

function getProviderConfig() {
  const apiKey = readServerEnv('AZURE_GPT54_API_KEY')
  const baseUrl = readServerEnv('AZURE_GPT54_BASE_URL')
  const configuredModel = readServerEnv('AZURE_GPT54_MODEL')
  const model = configuredModel || DEFAULT_AZURE_GPT54_MODEL
  const apiKeyEnv = getServerEnvStatus('AZURE_GPT54_API_KEY')
  const baseUrlEnv = getServerEnvStatus('AZURE_GPT54_BASE_URL')
  const modelEnv = getServerEnvStatus('AZURE_GPT54_MODEL')

  return {
    apiKey,
    baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : undefined,
    model,
    apiKeyConfigured: Boolean(apiKey),
    baseUrlConfigured: Boolean(baseUrl),
    modelConfigured: Boolean(configuredModel),
    envStatus: {
      apiKey: apiKeyEnv,
      baseUrl: baseUrlEnv,
      model: modelEnv,
    },
  }
}

function getHeaders(apiKey: string, authMode: AuthMode): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(authMode === 'api-key'
      ? { 'api-key': apiKey }
      : { Authorization: `Bearer ${apiKey}` }),
  }
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

function getSafeProviderError(status?: number): Error {
  if (status === 401 || status === 403) {
    return new Error('Model provider credentials are invalid or unauthorized.')
  }
  if (status === 404) {
    return new Error('Model deployment was not found.')
  }
  if (status === 429) {
    return new Error('Model provider is busy. Please try again.')
  }
  if (status != null && status >= 500) {
    return new Error('This EasyPlus mode is temporarily unavailable.')
  }
  return new Error('This EasyPlus mode is temporarily unavailable.')
}

function getSafeTimeoutError(): Error {
  return new Error('Model took too long to respond. Please try again.')
}

function getSafeConfigurationError(): Error {
  return new Error('Model provider is not configured.')
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
  console.warn('[Azure GPT-5.4] Retrying with alternate server-side auth header', {
    firstStatus: response.status,
    authMode,
  })
  response = await fetch(url, { ...init, headers: getHeaders(apiKey, authMode) })
  return { response, authMode }
}

function imagePartsFromAttachments(attachments?: ChatAttachment[]) {
  return (attachments || [])
    .filter((attachment) => attachment.type === 'image' && attachment.dataUrl)
    .map((attachment) => ({
      type: 'image_url' as const,
      image_url: { url: attachment.dataUrl! },
    }))
}

function toAzureChatMessages(messages: ChatMessage[], systemPromptText: string): AzureChatMessage[] {
  return [
    { role: 'system', content: systemPromptText },
    ...messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => {
        const text = message.content || ''
        const imageParts = message.role === 'user' ? imagePartsFromAttachments(message.attachments) : []
        if (imageParts.length === 0) {
          return { role: message.role, content: text } as AzureChatMessage
        }
        return {
          role: message.role,
          content: [
            { type: 'text', text: text.trim() || 'Please analyze the attached image.' },
            ...imageParts,
          ],
        } as AzureChatMessage
      }),
  ]
}

export async function getAzureGpt54Diagnostics(force = false): Promise<AzureGpt54Diagnostics> {
  const now = Date.now()
  const lastProbeAt = new Date(now).toISOString()
  if (!force && availabilityCache && now - availabilityCache.checkedAt < AVAILABILITY_CACHE_MS) {
    return availabilityCache.diagnostics
  }

  const { apiKey, baseUrl, model, apiKeyConfigured, baseUrlConfigured, modelConfigured, envStatus } = getProviderConfig()
  const endpoint = getEndpointMetadata(baseUrl)
  if (!apiKey || !baseUrl || !modelConfigured) {
    const diagnostics = {
      configured: Boolean(apiKey && baseUrl && modelConfigured),
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      probeOk: false,
      status: null,
      ...endpoint,
      model,
      lastProbeAt,
      envStatus,
      safeReason: 'Model provider is not configured.',
    }
    console.error('[Azure GPT-5.4] Missing provider configuration', {
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      model,
      envStatus,
      ...endpoint,
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
        model,
        lastProbeAt,
        envStatus,
        safeReason: response.status === 401 || response.status === 403
          ? 'Model provider credentials are invalid or unauthorized.'
          : response.status === 404
            ? 'Model deployment was not found.'
            : response.status === 429
              ? 'Model provider is busy. Please try again.'
              : 'This EasyPlus mode is temporarily unavailable.',
      }
      console.error('[Azure GPT-5.4] Availability probe failed', {
        status: response.status,
        authMode,
        baseUrlConfigured,
        modelConfigured,
        model,
        ...endpoint,
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
      model,
      lastProbeAt,
      envStatus,
      safeReason: available ? 'Available' : 'Azure provider returned no content',
    }
    console.info('[Azure GPT-5.4] Availability probe completed', {
      probeOk: available,
      status: response.status,
      authMode,
      baseUrlConfigured,
      modelConfigured,
      model,
      ...endpoint,
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
      model,
      lastProbeAt,
      envStatus,
      safeReason: error?.name === 'TimeoutError' ? 'Model took too long to respond. Please try again.' : 'This EasyPlus mode is temporarily unavailable.',
    }
    console.error('[Azure GPT-5.4] Availability probe exception', {
      message: error.message,
      timeoutHit: error?.name === 'TimeoutError',
      baseUrlConfigured,
      modelConfigured,
      model,
      ...endpoint,
      envStatus,
    })
    availabilityCache = { checkedAt: now, diagnostics }
  }

  return availabilityCache.diagnostics
}

export async function isAzureGpt54Available(): Promise<boolean> {
  return (await getAzureGpt54Diagnostics()).probeOk
}

export async function streamAzureGpt54Response(
  messages: ChatMessage[],
  systemPromptText: string,
  temperature: number = 0.7,
  maxTokens: number = 4096
): Promise<ReadableStream> {
  const { apiKey, baseUrl, model, apiKeyConfigured, baseUrlConfigured, modelConfigured, envStatus } = getProviderConfig()
  const endpoint = getEndpointMetadata(baseUrl)

  if (!apiKey || !baseUrl || !modelConfigured) {
    console.error('[Azure GPT-5.4] Missing provider configuration', {
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      model,
      envStatus,
      ...endpoint,
    })
    throw getSafeConfigurationError()
  }

  const controller = new AbortController()
  const totalTimeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const { response, authMode } = await fetchWithAuthFallback(getChatCompletionsUrl(baseUrl), apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: toAzureChatMessages(messages, systemPromptText),
        temperature,
        max_tokens: Math.min(maxTokens, 8192),
        stream: true,
      }),
      signal: controller.signal,
    })

    if (!response.ok || !response.body) {
      console.error('[Azure GPT-5.4] Request failed', {
        status: response.status,
        authMode,
        baseUrlConfigured,
        modelConfigured,
        model,
        ...endpoint,
      })
      throw getSafeProviderError(response.status)
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

        console.info('[Azure GPT-5.4] Stream opened', {
          streamStarted: true,
          baseUrlConfigured,
          modelConfigured,
          model,
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
                const delta = data?.choices?.[0]?.delta?.content
                const text = typeof delta === 'string'
                  ? delta
                  : Array.isArray(delta)
                    ? delta.map((part: any) => part?.text || '').join('')
                    : ''
                if (text) {
                  if (!contentStarted) {
                    contentStarted = true
                    clearTimeout(firstTokenTimeout)
                    console.info('[Azure GPT-5.4] First token received', {
                      streamStarted: true,
                      timeoutHit: false,
                    })
                  }
                  streamController.enqueue(encoder.encode(text))
                }
              } catch {
                console.warn('[Azure GPT-5.4] Ignored malformed stream event')
              }
            }
          }

          if (!contentStarted) {
            console.error('[Azure GPT-5.4] Stream closed without content', {
              streamStarted: true,
              timeoutHit: false,
            })
            throw getSafeProviderError()
          }

          streamController.close()
        } catch (error: any) {
          console.error('[Azure GPT-5.4] Stream failed', {
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
    if (
      error?.message?.startsWith('This EasyPlus mode') ||
      error?.message?.startsWith('Model provider') ||
      error?.message?.startsWith('Model deployment') ||
      error?.message?.startsWith('Model took')
    ) {
      throw error
    }
    const timeoutHit = error?.name === 'AbortError' || error?.name === 'TimeoutError'
    console.error('[Azure GPT-5.4] Request exception', {
      message: error.message,
      timeoutHit,
      streamStarted: false,
    })
    throw timeoutHit ? getSafeTimeoutError() : getSafeProviderError()
  }
}
