/**
 * AWS Bedrock Titan Image Generator v2
 * Server-side image generation using amazon.titan-image-generator-v2:0
 */

const BEDROCK_IMAGE_MODEL_ID = 'amazon.titan-image-generator-v2:0'

export interface BedrockImageGenerationRequest {
  prompt: string
  width?: number
  height?: number
  numberOfImages?: number
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
}

export interface BedrockImageResult {
  images: Array<{
    mimeType: string
    dataUrl: string
  }>
}

/**
 * Map aspect ratio to Titan dimensions
 */
function getImageDimensions(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case '1:1':
      return { width: 1024, height: 1024 }
    case '16:9':
      return { width: 1280, height: 768 }
    case '9:16':
      return { width: 768, height: 1280 }
    case '4:3':
      return { width: 1024, height: 768 }
    case '3:4':
      return { width: 768, height: 1024 }
    default:
      return { width: 1024, height: 1024 }
  }
}

/**
 * Generate image using AWS Bedrock Titan Image Generator v2
 */
export async function generateImageWithBedrock(
  request: BedrockImageGenerationRequest
): Promise<BedrockImageResult> {
  const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK
  const region = process.env.AWS_REGION || 'ap-southeast-2'

  if (!apiKey) {
    console.error('[Bedrock Image] FATAL: AWS_BEARER_TOKEN_BEDROCK is not set')
    throw new Error('Image generation is not configured')
  }

  const { prompt, aspectRatio = '1:1', numberOfImages = 1 } = request

  // Get dimensions from aspect ratio
  const dimensions = getImageDimensions(aspectRatio)

  const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${BEDROCK_IMAGE_MODEL_ID}/invoke`

  console.log('[Bedrock Image] Generating image with Titan v2')
  console.log('[Bedrock Image] Aspect ratio:', aspectRatio, '→', dimensions)

  // Titan Image Generator v2 payload
  const payload = {
    taskType: 'TEXT_IMAGE',
    textToImageParams: {
      text: prompt,
    },
    imageGenerationConfig: {
      numberOfImages,
      width: dimensions.width,
      height: dimensions.height,
      cfgScale: 8.0,
      seed: Math.floor(Math.random() * 2147483647),
    },
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Bedrock Image] API error:', {
        status: response.status,
        error: errorText.substring(0, 300),
      })

      throw new Error(
        `Bedrock image generation failed (${response.status}): ${errorText.substring(0, 200)}`
      )
    }

    const data = await response.json()

    // Titan returns: { images: ["base64..."] }
    if (!data.images || !Array.isArray(data.images) || data.images.length === 0) {
      console.error('[Bedrock Image] No images in response')
      throw new Error('No images were returned by the model')
    }

    console.log('[Bedrock Image] Generated', data.images.length, 'image(s)')

    // Convert base64 to data URLs
    const images = data.images.map((base64Data: string) => ({
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${base64Data}`,
    }))

    return { images }
  } catch (error: any) {
    console.error('[Bedrock Image] Fatal error:', {
      message: error.message,
      stack: error.stack?.substring(0, 300),
    })

    // Map to clean user-facing error
    if (error.message?.includes('throttl') || error.message?.includes('429')) {
      throw new Error('The image model is busy right now. Please try again in a moment.')
    }

    if (error.message?.includes('not found') || error.message?.includes('not supported')) {
      throw new Error('The image model is unavailable right now.')
    }

    if (error.message?.includes('timeout')) {
      throw new Error('Image generation timed out. Please try again.')
    }

    // Generic error
    throw new Error('Image generation failed. Please try again.')
  }
}

/**
 * Get the Bedrock image model ID (for reference)
 */
export function getBedrockImageModelId(): string {
  return BEDROCK_IMAGE_MODEL_ID
}
