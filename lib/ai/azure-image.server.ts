import 'server-only'

import { getServerEnvStatus, readServerEnv } from '@/lib/server-env'

const DEFAULT_AZURE_IMAGE_MODEL = 'gpt-image-2'
const REQUEST_TIMEOUT_MS = 180_000

export const AZURE_IMAGE_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const
export type AzureImageSize = typeof AZURE_IMAGE_SIZES[number]

export interface AzureImageResult {
  base64: string
  mimeType: 'image/png'
  sizeBytes: number
}

export type AzureImageErrorCategory =
  | 'configuration'
  | 'authentication'
  | 'not_found'
  | 'rate_limit'
  | 'provider'
  | 'response'
  | 'network'

export interface AzureImageDiagnostics {
  configured: boolean
  apiKeyConfigured: boolean
  baseUrlConfigured: boolean
  modelConfigured: boolean
  probeOk: boolean
  status: number | null
  endpointHost: string | null
  endpointPath: string
  model: string
  authMode: AuthMode | null
  lastProbeAt: string
  errorCategory: AzureImageErrorCategory | null
  envStatus: {
    apiKey: { exists: boolean; configured: boolean }
    baseUrl: { exists: boolean; configured: boolean }
    model: { exists: boolean; configured: boolean }
  }
  safeReason: string
}

let lastRequestDiagnostics: AzureImageDiagnostics | null = null

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

function getImageEditsUrl(baseUrl: string): string {
  return `${baseUrl}/images/edits`
}

type AuthMode = 'api-key' | 'bearer'

class AzureImageRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly safeReason: string,
    public readonly category: AzureImageErrorCategory
  ) {
    super(message)
    this.name = 'AzureImageRequestError'
  }
}

function getHeaders(apiKey: string, authMode: AuthMode, contentType?: string): Record<string, string> {
  return {
    ...(contentType ? { 'Content-Type': contentType } : {}),
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

function getEndpointPath(baseUrl?: string): string {
  if (!baseUrl) return '/images/generations'
  try {
    return new URL(getImagesUrl(baseUrl)).pathname
  } catch {
    return '/images/generations'
  }
}

function getMissingConfigDiagnostics(lastProbeAt: string): AzureImageDiagnostics {
  const { apiKey, baseUrl, apiKeyConfigured, baseUrlConfigured, model, modelConfigured, envStatus } = getProviderConfig()
  return {
    configured: Boolean(apiKey && baseUrl),
    apiKeyConfigured,
    baseUrlConfigured,
    modelConfigured,
    probeOk: false,
    status: null,
    endpointHost: getEndpointHost(baseUrl),
    endpointPath: getEndpointPath(baseUrl),
    model,
    authMode: null,
    lastProbeAt,
    errorCategory: 'configuration',
    envStatus,
    safeReason: !apiKey ? 'Missing Azure API key configuration' : 'Missing Azure base URL configuration',
  }
}

function getErrorDetails(status: number): { category: AzureImageErrorCategory; safeReason: string } {
  if (status === 401 || status === 403) return { category: 'authentication', safeReason: 'Invalid Azure key or unauthorized image deployment' }
  if (status === 404) return { category: 'not_found', safeReason: 'Azure image deployment endpoint not found' }
  if (status === 429) return { category: 'rate_limit', safeReason: 'Azure image provider is busy' }
  if (status >= 500) return { category: 'provider', safeReason: 'Azure image provider failed' }
  return { category: 'provider', safeReason: 'Azure image provider request failed' }
}

async function fetchWithAuthFallback(
  url: string,
  apiKey: string,
  init: Omit<RequestInit, 'headers'>,
  contentType?: string
): Promise<{ response: Response; authMode: AuthMode }> {
  let authMode: AuthMode = 'api-key'
  let response = await fetch(url, { ...init, headers: getHeaders(apiKey, authMode, contentType) })
  if (response.status !== 401 && response.status !== 403) return { response, authMode }

  await response.body?.cancel().catch(() => {})
  authMode = 'bearer'
  console.warn('[Azure Image] Retrying with alternate server-side auth header', {
    firstStatus: response.status,
    authMode,
  })
  response = await fetch(url, { ...init, headers: getHeaders(apiKey, authMode, contentType) })
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
  const endpointPath = getEndpointPath(baseUrl)
  if (!apiKey || !baseUrl) {
    console.error('[Azure Image] Missing provider configuration', {
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      envStatus,
      endpointHost,
      endpointPath,
      model,
    })
    throw new AzureImageRequestError(
      'Image Generation is temporarily unavailable.',
      null,
      !apiKey ? 'Missing Azure API key configuration' : 'Missing Azure base URL configuration',
      'configuration'
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
  }, 'application/json')

  const status = response.status
  const data = await response.json().catch(async () => {
    const text = await response.text().catch(() => '')
    return { error: text }
  })

  if (!response.ok) {
    const { category, safeReason } = getErrorDetails(status)
    lastRequestDiagnostics = {
      configured: true,
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      probeOk: false,
      status,
      endpointHost,
      endpointPath,
      model,
      authMode,
      lastProbeAt: new Date().toISOString(),
      errorCategory: category,
      envStatus,
      safeReason,
    }
    console.error('[Azure Image] Request failed', {
      status,
      authMode,
      baseUrlConfigured,
      modelConfigured,
      endpointHost,
      endpointPath,
      model,
      envStatus,
      safeReason,
      category,
    })
    throw new AzureImageRequestError(
      category === 'rate_limit'
        ? 'Image Generation is busy. Please try again in a moment.'
        : 'Image Generation is temporarily unavailable.',
      status,
      safeReason,
      category
    )
  }

  const base64 = parseBase64Image(data)
  if (base64) {
    lastRequestDiagnostics = {
      configured: true,
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      probeOk: true,
      status,
      endpointHost,
      endpointPath,
      model,
      authMode,
      lastProbeAt: new Date().toISOString(),
      errorCategory: null,
      envStatus,
      safeReason: 'Available',
    }
    return { base64, status }
  }

  const imageUrl = parseImageUrl(data)
  if (imageUrl) {
    const base64FromUrl = await fetchImageUrlAsBase64(imageUrl)
    lastRequestDiagnostics = {
      configured: true,
      apiKeyConfigured,
      baseUrlConfigured,
      modelConfigured,
      probeOk: true,
      status,
      endpointHost,
      endpointPath,
      model,
      authMode,
      lastProbeAt: new Date().toISOString(),
      errorCategory: null,
      envStatus,
      safeReason: 'Available',
    }
    return { base64: base64FromUrl, status }
  }

  console.error('[Azure Image] Response did not include image data', {
    status,
    baseUrlConfigured,
    modelConfigured,
    endpointHost,
    endpointPath,
    model,
  })
  lastRequestDiagnostics = {
    configured: true,
    apiKeyConfigured,
    baseUrlConfigured,
    modelConfigured,
    probeOk: false,
    status,
    endpointHost,
    endpointPath,
    model,
    authMode,
    lastProbeAt: new Date().toISOString(),
    errorCategory: 'response',
    envStatus,
    safeReason: 'Azure image provider returned no image data',
  }
  throw new AzureImageRequestError(
    'Image Generation is temporarily unavailable.',
    status,
    'Azure image provider returned no image data',
    'response'
  )
}

async function requestImageEdit(
  prompt: string,
  size: AzureImageSize,
  referenceImage: Buffer,
  referenceMimeType: string,
  timeoutMs: number
): Promise<{ base64: string; status: number }> {
  const { apiKey, baseUrl, model, apiKeyConfigured, baseUrlConfigured, modelConfigured, envStatus } = getProviderConfig()
  if (!apiKey || !baseUrl) {
    throw new AzureImageRequestError(
      'Image Generation is temporarily unavailable.',
      null,
      !apiKey ? 'Missing Azure API key configuration' : 'Missing Azure base URL configuration',
      'configuration'
    )
  }

  const endpointPath = '/images/edits'
  const formData = new FormData()
  formData.append('image[]', new Blob([new Uint8Array(referenceImage)], { type: referenceMimeType }), 'reference.png')
  formData.append('prompt', prompt)
  formData.append('model', model)
  formData.append('size', size)
  formData.append('n', '1')

  const { response, authMode } = await fetchWithAuthFallback(getImageEditsUrl(baseUrl), apiKey, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const status = response.status
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }))

  if (!response.ok) {
    const { category, safeReason } = getErrorDetails(status)
    console.error('[Azure Image] Edit request failed', {
      status,
      authMode,
      baseUrlConfigured,
      modelConfigured,
      endpointPath,
      model,
      safeReason,
      category,
    })
    throw new AzureImageRequestError(
      status === 404 || status === 405
        ? 'Image editing is not supported by the current image model yet.'
        : category === 'rate_limit'
          ? 'Image Generation is busy. Please try again in a moment.'
          : 'Could not edit the previous image. Try generating a new image.',
      status,
      status === 404 || status === 405 ? 'Azure image edit endpoint is unsupported' : safeReason,
      category
    )
  }

  const base64 = parseBase64Image(data)
  if (!base64) {
    console.error('[Azure Image] Edit response did not include image data', {
      status,
      endpointPath,
      model,
    })
    throw new AzureImageRequestError(
      'Could not edit the previous image. Try generating a new image.',
      status,
      'Azure image edit provider returned no image data',
      'response'
    )
  }

  return { base64, status }
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

export async function editAzureImage(
  prompt: string,
  size: AzureImageSize,
  referenceImage: Buffer,
  referenceMimeType: string
): Promise<AzureImageResult> {
  const result = await requestImageEdit(prompt, size, referenceImage, referenceMimeType, REQUEST_TIMEOUT_MS)
  const sizeBytes = Buffer.byteLength(result.base64, 'base64')
  console.info('[Azure Image] Edit completed', {
    status: result.status,
    size,
    sizeBytes,
    endpointPath: '/images/edits',
  })
  return {
    base64: result.base64,
    mimeType: 'image/png',
    sizeBytes,
  }
}

export async function getAzureImageDiagnostics(_force = false): Promise<AzureImageDiagnostics> {
  const now = Date.now()
  const lastProbeAt = new Date(now).toISOString()

  const config = getProviderConfig()
  if (!config.apiKey || !config.baseUrl) {
    const diagnostics = getMissingConfigDiagnostics(lastProbeAt)
    console.error('[Azure Image] Missing provider configuration', {
      apiKeyConfigured: Boolean(config.apiKey),
      baseUrlConfigured: config.baseUrlConfigured,
      modelConfigured: config.modelConfigured,
      envStatus: config.envStatus,
      endpointHost: getEndpointHost(config.baseUrl),
      endpointPath: getEndpointPath(config.baseUrl),
      model: config.model,
    })
    lastRequestDiagnostics = diagnostics
    return diagnostics
  }

  return lastRequestDiagnostics || {
    configured: true,
    apiKeyConfigured: config.apiKeyConfigured,
    baseUrlConfigured: config.baseUrlConfigured,
    modelConfigured: config.modelConfigured,
    probeOk: true,
    status: null,
    endpointHost: getEndpointHost(config.baseUrl),
    endpointPath: getEndpointPath(config.baseUrl),
    model: config.model,
    authMode: null,
    lastProbeAt,
    errorCategory: null,
    envStatus: config.envStatus,
    safeReason: 'Configured; availability is checked on generation',
  }
}

export async function isAzureImageAvailable(): Promise<boolean> {
  return (await getAzureImageDiagnostics()).configured
}
