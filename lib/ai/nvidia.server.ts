import 'server-only'

import type { ChatMessage } from '@/types/models'
import { readFirstServerEnv, readServerEnv } from '@/lib/server-env'

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const NVIDIA_DEEPSEEK_V4_PRO_MODEL = 'deepseek-ai/deepseek-v4-pro'
const REQUEST_TIMEOUT_MS = 120_000
const FIRST_TOKEN_TIMEOUT_MS = 45_000
const AVAILABILITY_CACHE_MS = 5 * 60_000

export interface DeepSeekProviderDiagnostics {
  configured: boolean
  baseUrlConfigured: boolean
  probeOk: boolean
  status: number | null
  safeReason: string
}

let availabilityCache: { checkedAt: number; diagnostics: DeepSeekProviderDiagnostics } | null = null

function getProviderConfig() {
  const key = readFirstServerEnv(['DEEPSEEK_V4_PRO_API_KEY', 'NVIDIA_API_KEY'])
  const configuredBaseUrl = readServerEnv('DEEPSEEK_V4_PRO_BASE_URL')
  return {
    apiKey: key.value,
    apiKeySource: key.source,
    baseUrl: normalizeDeepSeekBaseUrl(configuredBaseUrl || NVIDIA_BASE_URL),
    baseUrlConfigured: Boolean(configuredBaseUrl),
    model: readServerEnv('DEEPSEEK_V4_PRO_MODEL') || NVIDIA_DEEPSEEK_V4_PRO_MODEL,
  }
}

function normalizeDeepSeekBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed === 'https://integrate.api.nvidia.com') return `${trimmed}/v1`
  return trimmed
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

export async function getDeepSeekV4ProDiagnostics(force = false): Promise<DeepSeekProviderDiagnostics> {
  const now = Date.now()
  if (!force && availabilityCache && now - availabilityCache.checkedAt < AVAILABILITY_CACHE_MS) {
    return availabilityCache.diagnostics
  }

  const { apiKey, baseUrl, model, baseUrlConfigured } = getProviderConfig()
  if (!apiKey) {
    console.error('[DeepSeek Provider] Missing API key env', {
      checked: ['DEEPSEEK_V4_PRO_API_KEY', 'NVIDIA_API_KEY'],
      baseUrlConfigured,
    })
    const diagnostics = {
      configured: false,
      baseUrlConfigured,
      probeOk: false,
      status: null,
      safeReason: 'Missing API key configuration',
    }
    availabilityCache = { checkedAt: now, diagnostics }
    return diagnostics
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply OK.' }],
        temperature: 0,
        max_tokens: 2,
        extra_body: {
          chat_template_kwargs: {
            thinking: false,
          },
        },
        stream: false,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error('[DeepSeek Provider] Availability probe failed:', {
        status: response.status,
        baseUrlConfigured,
        error: errorText.substring(0, 300),
      })
      const diagnostics = {
        configured: true,
        baseUrlConfigured,
        probeOk: false,
        status: response.status,
        safeReason: response.status === 401 || response.status === 403
          ? 'Invalid or unsupported endpoint/key'
          : response.status === 404
            ? 'Model endpoint not found'
            : response.status === 429
              ? 'Provider is busy'
              : 'Provider request failed',
      }
      availabilityCache = { checkedAt: now, diagnostics }
      return diagnostics
    }

    const data = await response.json().catch(() => null)
    const content = data?.choices?.[0]?.message?.content
    const available = typeof content === 'string' && content.trim().length > 0
    console.info('[DeepSeek Provider] Availability probe completed:', {
      available,
      baseUrlConfigured,
      status: response.status,
    })
    availabilityCache = {
      checkedAt: now,
      diagnostics: {
        configured: true,
        baseUrlConfigured,
        probeOk: available,
        status: response.status,
        safeReason: available ? 'Available' : 'Provider returned no content',
      },
    }
  } catch (error: any) {
    console.error('[DeepSeek Provider] Availability probe exception:', {
      message: error.message,
      timeoutHit: error?.name === 'TimeoutError',
    })
    availabilityCache = {
      checkedAt: now,
      diagnostics: {
        configured: true,
        baseUrlConfigured,
        probeOk: false,
        status: null,
        safeReason: error?.name === 'TimeoutError' ? 'Provider probe timed out' : 'Provider is unreachable',
      },
    }
  }

  return availabilityCache.diagnostics
}

export async function isDeepSeekV4ProEndpointAvailable(): Promise<boolean> {
  return (await getDeepSeekV4ProDiagnostics()).probeOk
}

export async function streamDeepSeekV4ProResponse(
  messages: ChatMessage[],
  systemPromptText: string,
  temperature: number = 0.7,
  maxTokens: number = 16384
): Promise<ReadableStream> {
  const { apiKey, baseUrl, model, baseUrlConfigured, apiKeySource } = getProviderConfig()

  if (!apiKey) {
    console.error('[DeepSeek Provider] Missing API key env', {
      checked: ['DEEPSEEK_V4_PRO_API_KEY', 'NVIDIA_API_KEY'],
      baseUrlConfigured,
    })
    throw getSafeProviderError()
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPromptText },
          ...messages
            .filter((message) => message.role === 'user' || message.role === 'assistant')
            .map((message) => ({ role: message.role, content: message.content || '' })),
        ],
        temperature,
        top_p: 0.95,
        max_tokens: maxTokens,
        extra_body: {
          chat_template_kwargs: {
            thinking: false,
          },
        },
        stream: true,
      }),
      signal: controller.signal,
    })

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '')
      console.error('[DeepSeek Provider] Request failed:', {
        status: response.status,
        baseUrlConfigured,
        apiKeySource,
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

        console.info('[DeepSeek Provider] Stream opened:', {
          baseUrlConfigured,
          streamStarted: true,
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
                    console.info('[DeepSeek Provider] First token received:', {
                      streamStarted: true,
                      timeoutHit: false,
                    })
                  }
                  streamController.enqueue(encoder.encode(text))
                }
              } catch {
                console.warn('[DeepSeek Provider] Ignored malformed stream event')
              }
            }
          }

          if (!contentStarted) {
            console.error('[DeepSeek Provider] Stream closed without content:', {
              streamStarted: true,
              timeoutHit: false,
            })
            throw getSafeProviderError()
          }

          streamController.close()
        } catch (error: any) {
          console.error('[DeepSeek Provider] Stream failed:', {
            message: error.message,
            streamStarted: true,
            timeoutHit: firstTokenTimeoutHit,
          })
          streamController.error(firstTokenTimeoutHit ? getSafeTimeoutError() : getSafeProviderError())
        } finally {
          clearTimeout(firstTokenTimeout)
          clearTimeout(timeout)
          reader.releaseLock()
        }
      },
      cancel() {
        clearTimeout(timeout)
        controller.abort()
        reader.cancel().catch(() => {})
      },
    })
  } catch (error: any) {
    clearTimeout(timeout)
    if (error?.message?.startsWith('DeepSeek V4 Pro')) throw error
    const timeoutHit = error?.name === 'AbortError' || error?.name === 'TimeoutError'
    console.error('[DeepSeek Provider] Request exception:', {
      message: error.message,
      timeoutHit,
      streamStarted: false,
    })
    throw timeoutHit ? getSafeTimeoutError() : getSafeProviderError()
  }
}
