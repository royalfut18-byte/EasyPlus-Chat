import 'server-only'

import { readFirstServerEnv, readServerEnv } from '@/lib/server-env'

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const NVIDIA_QWEN_IMAGE_MODEL = 'qwen-image-2512'
const REQUEST_TIMEOUT_MS = 280_000
const AVAILABILITY_CACHE_MS = 5 * 60_000

export interface NvidiaImageProviderDiagnostics {
  configured: boolean
  baseUrlConfigured: boolean
  probeOk: boolean
  status: number | null
  endpointPath: '/images/generations'
  safeReason: string
}

let availabilityCache: { checkedAt: number; diagnostics: NvidiaImageProviderDiagnostics } | null = null

const IMAGE_SIZES: Record<string, string> = {
  '1:1': '1328x1328',
  '16:9': '1664x928',
  '9:16': '928x1664',
  '4:3': '1472x1104',
  '3:4': '1104x1472',
}

function getProviderConfig() {
  const key = readFirstServerEnv(['NVIDIA_IMAGE_API_KEY', 'NVIDIA_API_KEY'])
  const configuredBaseUrl = readServerEnv('NVIDIA_IMAGE_BASE_URL')
  return {
    apiKey: key.value,
    apiKeySource: key.source,
    baseUrl: normalizeImageBaseUrl(configuredBaseUrl || NVIDIA_BASE_URL),
    baseUrlConfigured: Boolean(configuredBaseUrl),
    model: readServerEnv('NVIDIA_IMAGE_MODEL') || NVIDIA_QWEN_IMAGE_MODEL,
  }
}

function normalizeImageBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed === 'https://integrate.api.nvidia.com') return `${trimmed}/v1`
  return trimmed
}

function getSafeProviderError(status?: number): Error {
  if (status === 429) {
    return new Error('Image Generation is busy right now. Please try again shortly.')
  }
  return new Error('Image Generation is temporarily unavailable.')
}

export function isNvidiaImageAvailable(): boolean {
  return Boolean(getProviderConfig().apiKey)
}

export async function getNvidiaImageDiagnostics(force = false): Promise<NvidiaImageProviderDiagnostics> {
  const now = Date.now()
  if (!force && availabilityCache && now - availabilityCache.checkedAt < AVAILABILITY_CACHE_MS) {
    return availabilityCache.diagnostics
  }

  const { apiKey, baseUrl, baseUrlConfigured } = getProviderConfig()
  const endpointPath = '/images/generations' as const
  if (!apiKey) {
    const diagnostics = {
      configured: false,
      baseUrlConfigured,
      probeOk: false,
      status: null,
      endpointPath,
      safeReason: 'Missing API key configuration',
    }
    availabilityCache = { checkedAt: now, diagnostics }
    return diagnostics
  }

  try {
    const response = await fetch(`${baseUrl}/health/ready`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
    const probeOk = response.ok
    const diagnostics = {
      configured: true,
      baseUrlConfigured,
      probeOk,
      status: response.status,
      endpointPath,
      safeReason: probeOk
        ? 'Available'
        : response.status === 404
          ? 'Image provider endpoint not found'
          : response.status === 401 || response.status === 403
            ? 'Invalid or unsupported endpoint/key'
            : 'Image provider health check failed',
    }
    console.info('[NVIDIA Image] Availability probe completed:', {
      status: response.status,
      probeOk,
      baseUrlConfigured,
      endpointPath,
    })
    availabilityCache = { checkedAt: now, diagnostics }
  } catch (error: any) {
    const diagnostics = {
      configured: true,
      baseUrlConfigured,
      probeOk: false,
      status: null,
      endpointPath,
      safeReason: error?.name === 'TimeoutError' ? 'Image provider probe timed out' : 'Image provider is unreachable',
    }
    console.error('[NVIDIA Image] Availability probe failed:', {
      message: error.message,
      timeoutHit: error?.name === 'TimeoutError',
      baseUrlConfigured,
      endpointPath,
    })
    availabilityCache = { checkedAt: now, diagnostics }
  }

  return availabilityCache.diagnostics
}

export interface ImageGenerationRequest {
  prompt: string
  aspectRatio?: string
}

export interface ImageGenerationResponse {
  imageData: string
  mimeType: 'image/png'
  format: 'png'
  sizeBytes: number
}

export async function generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const { apiKey, baseUrl, model, baseUrlConfigured, apiKeySource } = getProviderConfig()

  if (!apiKey) {
    console.error('[NVIDIA Image] Missing API key env', {
      checked: ['NVIDIA_IMAGE_API_KEY', 'NVIDIA_API_KEY'],
      baseUrlConfigured,
    })
    throw getSafeProviderError()
  }

  const prompt = request.prompt?.trim()
  if (!prompt) {
    throw new Error('Image prompt cannot be empty.')
  }
  if (prompt.length > 800) {
    throw new Error('Image prompt is too long. Keep it under 800 characters.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        response_format: 'b64_json',
        size: IMAGE_SIZES[request.aspectRatio || '1:1'] || IMAGE_SIZES['1:1'],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error('[NVIDIA Image] Generation failed:', {
        status: response.status,
        baseUrlConfigured,
        apiKeySource,
        error: errorText.substring(0, 300),
      })
      throw getSafeProviderError(response.status)
    }

    const data = await response.json()
    const imageData = data.data?.[0]?.b64_json
    if (typeof imageData !== 'string' || !imageData) {
      console.error('[NVIDIA Image] Unexpected response format')
      throw getSafeProviderError()
    }

    return {
      imageData,
      mimeType: 'image/png',
      format: 'png',
      sizeBytes: Buffer.byteLength(imageData, 'base64'),
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.error('[NVIDIA Image] Request timeout')
      throw new Error('Image generation took too long. Please try again.')
    }
    if (error instanceof Error) throw error
    console.error('[NVIDIA Image] Unexpected error')
    throw getSafeProviderError()
  } finally {
    clearTimeout(timeout)
  }
}
