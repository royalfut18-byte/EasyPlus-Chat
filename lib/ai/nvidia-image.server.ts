import 'server-only'

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const NVIDIA_QWEN_IMAGE_MODEL = 'qwen/qwen-image-2512'
const REQUEST_TIMEOUT_MS = 280_000

const IMAGE_SIZES: Record<string, string> = {
  '1:1': '1328x1328',
  '16:9': '1664x928',
  '9:16': '928x1664',
  '4:3': '1472x1104',
  '3:4': '1104x1472',
}

function getProviderConfig() {
  return {
    apiKey: process.env.NVIDIA_IMAGE_API_KEY || process.env.NVIDIA_API_KEY,
    baseUrl: (process.env.NVIDIA_IMAGE_BASE_URL || NVIDIA_BASE_URL).replace(/\/+$/, ''),
    model: process.env.NVIDIA_IMAGE_MODEL || NVIDIA_QWEN_IMAGE_MODEL,
  }
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
  const { apiKey, baseUrl, model } = getProviderConfig()

  if (!apiKey) {
    console.error('[NVIDIA Image] API key is not configured')
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
