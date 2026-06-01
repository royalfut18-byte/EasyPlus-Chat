import 'server-only'

import type { ChatMessage } from '@/types/models'
import { readServerEnv } from '@/lib/server-env'

const DEFAULT_AZURE_DEEPSEEK_MODEL = 'DeepSeek-V4-Pro'
const REQUEST_TIMEOUT_MS = 120_000
const FIRST_TOKEN_TIMEOUT_MS = 45_000
const AVAILABILITY_CACHE_MS = 5 * 60_000

export interface AzureDeepSeekDiagnostics {
  configured: boolean
  baseUrlConfigured: boolean
  modelConfigured: boolean
  probeOk: boolean
  status: number | null
  safeReason: string
}

let availabilityCache: { checkedAt: number; diagnostics: AzureDeepSeekDiagnostics } | null = null

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function getProviderConfig() {
  const apiKey = readServerEnv('AZURE_FOUNDRY_API_KEY')
  const baseUrl = readServerEnv('AZURE_OPENAI_BASE_URL')
  const model = readServerEnv('AZURE_DEEPSEEK_MODEL') || DEFAULT_AZURE_DEEPSEEK_MODEL

  return {
    apiKey,
    baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : undefined,
    baseUrlConfigured: Boolean(baseUrl),
    model,
    modelConfigured: Boolean(readServerEnv('AZURE_DEEPSEEK_MODEL')),
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

function getHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'api-key': apiKey,
  }
}

function getChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl}/chat/completions`
}

export async function getAzureDeepSeekDiagnostics(force = false): Promise<AzureDeepSeekDiagnostics> {
  const now = Date.now()
  if (!force && availabilityCache && now - availabilityCache.checkedAt < AVAILABILITY_CACHE_MS) {
    return availabilityCache.diagnostics
  }

  const { apiKey, baseUrl, model, baseUrlConfigured, modelConfigured } = getProviderConfig()
  if (!apiKey || !baseUrl) {
    const diagnostics = {
      configured: Boolean(apiKey && baseUrl),
      baseUrlConfigured,
      modelConfigured,
      probeOk: false,
      status: null,
      safeReason: !apiKey ? 'Missing Azure API key configuration' : 'Missing Azure base URL configuration',
    }
    console.error('[Azure DeepSeek] Missing provider configuration', {
      apiKeyConfigured: Boolean(apiKey),
      baseUrlConfigured,
      modelConfigured,
    })
    availabilityCache = { checkedAt: now, diagnostics }
    return diagnostics
  }

  try {
    const response = await fetch(getChatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: getHeaders(apiKey),
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
      const errorText = await response.text().catch(() => '')
      const diagnostics = {
        configured: true,
        baseUrlConfigured,
        modelConfigured,
        probeOk: false,
        status: response.status,
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
        baseUrlConfigured,
        modelConfigured,
        error: errorText.substring(0, 300),
      })
      availabilityCache = { checkedAt: now, diagnostics }
      return diagnostics
    }

    const data = await response.json().catch(() => null)
    const content = data?.choices?.[0]?.message?.content
    const available = typeof content === 'string' && content.trim().length > 0
    const diagnostics = {
      configured: true,
      baseUrlConfigured,
      modelConfigured,
      probeOk: available,
      status: response.status,
      safeReason: available ? 'Available' : 'Azure provider returned no content',
    }
    console.info('[Azure DeepSeek] Availability probe completed', {
      probeOk: available,
      status: response.status,
      baseUrlConfigured,
      modelConfigured,
    })
    availabilityCache = { checkedAt: now, diagnostics }
  } catch (error: any) {
    const diagnostics = {
      configured: true,
      baseUrlConfigured,
      modelConfigured,
      probeOk: false,
      status: null,
      safeReason: error?.name === 'TimeoutError' ? 'Azure provider probe timed out' : 'Azure provider is unreachable',
    }
    console.error('[Azure DeepSeek] Availability probe exception', {
      message: error.message,
      timeoutHit: error?.name === 'TimeoutError',
      baseUrlConfigured,
      modelConfigured,
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
  const { apiKey, baseUrl, model, baseUrlConfigured, modelConfigured } = getProviderConfig()

  if (!apiKey || !baseUrl) {
    console.error('[Azure DeepSeek] Missing provider configuration', {
      apiKeyConfigured: Boolean(apiKey),
      baseUrlConfigured,
      modelConfigured,
    })
    throw getSafeProviderError()
  }

  const controller = new AbortController()
  const totalTimeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(getChatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: getHeaders(apiKey),
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
      const errorText = await response.text().catch(() => '')
      console.error('[Azure DeepSeek] Request failed', {
        status: response.status,
        baseUrlConfigured,
        modelConfigured,
        error: errorText.substring(0, 300),
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
    throw timeoutHit ? getSafeTimeoutError() : getSafeProviderError()
  }
}
