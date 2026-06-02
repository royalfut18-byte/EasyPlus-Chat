import 'server-only'

import { getServerEnvStatus, readServerEnv } from '@/lib/server-env'

const DEFAULT_AZURE_IMAGE_MODEL = 'gpt-image-2'
const REQUEST_TIMEOUT_MS = 180_000
const PROBE_TIMEOUT_MS = 120_000
const AVAILABILITY_CACHE_MS = 5 * 60_000

export const AZURE_IMAGE_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const
export type AzureImageSize = typeof AZURE_IMAGE_SIZES[number]

export interface AzureImageResult {
  base64: string
  mimeType: 'image/png'
  sizeBytes: number
}

export interface AzureImageDiagnostics {
  configured: boolean
  apiKeyConfigured: boolean
  baseUrlConfigured: boolean
  modelConfigured: boolean
  probeOk: boolean
  status: number | null
  endpointHost: string | null
  endpointPath: '/images/generations'
  lastProbeAt: string
  safeReason: string
}

let availabilityCache: { checkedAt: number; diagnostics: AzureImageDiagnostics } | null = null

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function getProviderConfig() {
  const apiKey = readServerEnv('AZURE_IMAGE_API_KEY')
  const baseUrl = readServerEnv('AZURE_IMAGE_BASE_URL')
  const model = readServerEnv('AZURE_IMAGE_MODEL') || DEFAULT_AZURE_IMAGE_MODEL
  const apiKeyEnv = getServerEnvStatus('AZURE_IMAGE_API_KEY')
  const baseUrlEnv = getServerEnvStatus('AZURE_IMAGE_BASE_URL')
  const modelEnv = getServerEnvStatus('AZURE_IMAGE_MODEL')

  return {
    apiKey,
    baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : undefined,
    apiKeyConfigured: Boolean(apiKey),
    baseUrlConfigured: Boolean(baseUrl),
    model,
    modelConfigured: Boolean(model),
    envStatus: {
      apiKey: apiKeyEnv,
      baseUrl: baseUrlEnv,
      model: modelEnv,
    },
  }
}

function getImagesUrl(baseUrl: string): string {
  return `${baseUrl}/images/generations`
}

type AuthMode = 'api-key' | 'bearer'

class AzureImageRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly safeReason: string
  ) {
    super(message)
    this.name = 'AzureImageRequestError'
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

function getEndpointHost(baseUrl?: string): string | null {
  if (!baseUrl) return null
  try {
    return new URL(getImagesUrl(baseUrl)).hostname
  } catch {
    return null
  }
}

function getMissingConfigDiagnostics(lastProbeAt: string): AzureImageDiagnostics {
  const { apiKey, baseUrl, apiKeyConfigured, baseUrlConfigured, modelConfigured } = getProviderConfig()
  return {
    configured: Boolean(apiKey && baseUrl),
    apiKeyConfigured,
    baseUrlConfigured,
    modelConfigured,
    probeOk: false,
    status: null,
    endpointHost: getEndpointHost(baseUrl),
    endpointPath: '/images/generations',
    lastProbeAt,
    safeReason: !apiKey ? 'Missing Azure API key configuration' : 'Missing Azure base URL configuration',
  }
}

function getSafeReason(status: number): string {
  if (status === 401 || status === 403) return 'Invalid Azure key or unauthorized image deployment'
  if (status === 404) return 'Azure image deployment endpoint not found'
  if (status === 429) return 'Azure image provider is busy'
  if (status >= 500) return 'Azure image provider failed'
  return 'Azure image provider request failed'
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
  console.warn('[Azure Image] Retrying with alternate server-side auth header', {
    firstStatus: response.status,
    authMode,
  })
  response = await fetch(url, { ...init, headers: getHeaders(apiKey, authMode) })
  return { response, authMode }
}

function parseBase64Image(data: unknown): string | null {
  const first = (data as any)?.data?.[0]
  const b64 = first?.b64_json || first?.b64 || first?.image_base64
  return typeof b64 === 'string' && b64.trim() ? b64.trim() : null
}

function parseImageUrl(data: unknown): string | null {
  const url = (data as any)?.data?.[0]?.url
  return typeof url === 'string' && url.trim() ? url.trim() : null
}

async function fetchImageUrlAsBase64(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`Image URL fetch failed with status ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer).toString('base64')
}

async function requestImage(prompt: string, size: AzureImageSize, timeoutMs: number): Promise<{ base64: string; status: number }> {
  const { apiKey, baseUrl, model, apiKeyConfigured, baseUrlConfigured, modelConfigured, envStatus } = getProviderConfig()
  const endpointHost = getEndpointHost(baseUrl)
  if (!apiKey || !baseUrl) {
    console.error('[Azure Image] Missing provider configuration', {
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      envStatus,
      endpointHost,
      endpointPath: '/images/generations',
      model,
    })
    throw new AzureImageRequestError(
      'Image Generation is temporarily unavailable.',
      null,
      !apiKey ? 'Missing Azure API key configuration' : 'Missing Azure base URL configuration'
    )
  }

  const { response, authMode } = await fetchWithAuthFallback(getImagesUrl(baseUrl), apiKey, {
    method: 'POST',
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const status = response.status
  const data = await response.json().catch(async () => {
    const text = await response.text().catch(() => '')
    return { error: text }
  })

  if (!response.ok) {
    const safeReason = getSafeReason(status)
    console.error('[Azure Image] Request failed', {
      status,
      authMode,
      baseUrlConfigured,
      modelConfigured,
      endpointHost,
      endpointPath: '/images/generations',
      model,
      safeReason,
    })
    throw new AzureImageRequestError('Image Generation is temporarily unavailable.', status, safeReason)
  }

  const base64 = parseBase64Image(data)
  if (base64) return { base64, status }

  const imageUrl = parseImageUrl(data)
  if (imageUrl) return { base64: await fetchImageUrlAsBase64(imageUrl), status }

  console.error('[Azure Image] Response did not include image data', {
    status,
    baseUrlConfigured,
    modelConfigured,
    endpointHost,
    endpointPath: '/images/generations',
    model,
  })
  throw new AzureImageRequestError('Image Generation is temporarily unavailable.', status, 'Azure image provider returned no image data')
}

export function isValidAzureImageSize(size: unknown): size is AzureImageSize {
  return typeof size === 'string' && (AZURE_IMAGE_SIZES as readonly string[]).includes(size)
}

export function sanitizeImagePrompt(prompt: unknown): string {
  if (typeof prompt !== 'string') return ''
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 2000)
}

export async function generateAzureImage(prompt: string, size: AzureImageSize): Promise<AzureImageResult> {
  const result = await requestImage(prompt, size, REQUEST_TIMEOUT_MS)
  const sizeBytes = Buffer.byteLength(result.base64, 'base64')
  console.info('[Azure Image] Generation completed', {
    status: result.status,
    size,
    sizeBytes,
    endpointPath: '/images/generations',
  })
  return {
    base64: result.base64,
    mimeType: 'image/png',
    sizeBytes,
  }
}

export async function getAzureImageDiagnostics(force = false): Promise<AzureImageDiagnostics> {
  const now = Date.now()
  const lastProbeAt = new Date(now).toISOString()
  if (!force && availabilityCache && now - availabilityCache.checkedAt < AVAILABILITY_CACHE_MS) {
    return availabilityCache.diagnostics
  }

  const config = getProviderConfig()
  if (!config.apiKey || !config.baseUrl) {
    const diagnostics = getMissingConfigDiagnostics(lastProbeAt)
    console.error('[Azure Image] Missing provider configuration', {
      apiKeyConfigured: Boolean(config.apiKey),
      baseUrlConfigured: config.baseUrlConfigured,
      modelConfigured: config.modelConfigured,
      envStatus: config.envStatus,
      endpointHost: getEndpointHost(config.baseUrl),
      endpointPath: '/images/generations',
      model: config.model,
    })
    availabilityCache = { checkedAt: now, diagnostics }
    return diagnostics
  }

  try {
    const probe = await requestImage('A simple white dot on a plain black background', '1024x1024', PROBE_TIMEOUT_MS)
    const diagnostics: AzureImageDiagnostics = {
      configured: true,
      apiKeyConfigured: config.apiKeyConfigured,
      baseUrlConfigured: config.baseUrlConfigured,
      modelConfigured: config.modelConfigured,
      probeOk: true,
      status: probe.status,
      endpointHost: getEndpointHost(config.baseUrl),
      endpointPath: '/images/generations',
      lastProbeAt,
      safeReason: 'Available',
    }
    console.info('[Azure Image] Availability probe completed', {
      probeOk: true,
      status: probe.status,
      baseUrlConfigured: config.baseUrlConfigured,
      modelConfigured: config.modelConfigured,
      endpointHost: getEndpointHost(config.baseUrl),
      endpointPath: '/images/generations',
      model: config.model,
    })
    availabilityCache = { checkedAt: now, diagnostics }
  } catch (error: any) {
    const timeoutHit = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    const diagnostics: AzureImageDiagnostics = {
      configured: true,
      apiKeyConfigured: config.apiKeyConfigured,
      baseUrlConfigured: config.baseUrlConfigured,
      modelConfigured: config.modelConfigured,
      probeOk: false,
      status: error instanceof AzureImageRequestError ? error.status : null,
      endpointHost: getEndpointHost(config.baseUrl),
      endpointPath: '/images/generations',
      lastProbeAt,
      safeReason: timeoutHit
        ? 'Azure image provider probe timed out'
        : error instanceof AzureImageRequestError
          ? error.safeReason
          : 'Azure image provider is unavailable',
    }
    console.error('[Azure Image] Availability probe exception', {
      message: error?.message,
      timeoutHit,
      baseUrlConfigured: config.baseUrlConfigured,
      modelConfigured: config.modelConfigured,
      endpointHost: getEndpointHost(config.baseUrl),
      endpointPath: '/images/generations',
      model: config.model,
    })
    availabilityCache = { checkedAt: now, diagnostics }
  }

  return availabilityCache.diagnostics
}

export async function isAzureImageAvailable(): Promise<boolean> {
  return (await getAzureImageDiagnostics()).probeOk
}
