import { AI_MODELS, type ChatMessage } from '@/types/models'

/**
 * Convert data URL to Bedrock Converse image format
 */
function dataUrlToBedrockImage(dataUrl: string, mimeType?: string): { format: string; bytes: string } {
  if (!dataUrl.startsWith('data:image/')) {
    throw new Error('Invalid image data URL: must start with data:image/')
  }

  if (!dataUrl.includes('base64,')) {
    throw new Error('Invalid image data URL: must contain base64 data')
  }

  const base64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!base64Match) {
    throw new Error('Invalid image data URL format')
  }

  const extractedMimeType = base64Match[1]
  const base64Data = base64Match[2]

  if (!base64Data) {
    throw new Error('Invalid image data URL: no base64 data found')
  }

  const finalMimeType = mimeType || extractedMimeType
  let format: string

  switch (finalMimeType.toLowerCase()) {
    case 'image/png':
      format = 'png'
      break
    case 'image/jpeg':
    case 'image/jpg':
      format = 'jpeg'
      break
    case 'image/webp':
      format = 'webp'
      break
    default:
      throw new Error('Unsupported image type. Please use PNG, JPEG, or WebP.')
  }

  return {
    format,
    bytes: base64Data,
  }
}

export async function streamBedrockResponse(
  modelId: string,
  messages: ChatMessage[],
  systemPromptText?: string,
  temperature: number = 0.7,
  maxTokens: number = 16384
): Promise<ReadableStream> {
  const model = AI_MODELS.find((m) => m.id === modelId)

  if (!model) {
    console.error('[Bedrock] Unknown model ID:', modelId)
    throw new Error(`Unknown model: ${modelId}`)
  }

  const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK
  const region = process.env.AWS_REGION || 'ap-southeast-2'

  if (!apiKey) {
    console.error('[Bedrock] FATAL: AWS_BEARER_TOKEN_BEDROCK is not set')
    throw new Error('Missing AWS_BEARER_TOKEN_BEDROCK')
  }

  const bedrockMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const content: any[] = []

      if (message.attachments && message.attachments.length > 0) {
        for (const attachment of message.attachments) {
          if (attachment.type === 'image' && attachment.dataUrl) {
            try {
              const { format, bytes } = dataUrlToBedrockImage(attachment.dataUrl, attachment.mimeType)
              content.push({
                image: {
                  format,
                  source: {
                    bytes,
                  },
                },
              })
            } catch (error: any) {
              console.error('[Bedrock] Failed to process image:', error.message)
              throw new Error(`Image processing failed: ${error.message}`)
            }
          }
        }
      }

      if (message.content && message.content.trim()) {
        content.push({ text: message.content })
      }

      if (content.length > 0 && content.some(c => c.image) && !message.content) {
        content.push({ text: 'Please analyze this image.' })
      }

      if (content.length === 0) {
        content.push({ text: message.content || '' })
      }

      return {
        role: message.role,
        content,
      }
    })

  const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${model.bedrockModelId}/converse`

  const finalSystemPrompt = systemPromptText || `You are ${model.name}, a helpful assistant.`

  const systemPrompt = [
    {
      text: finalSystemPrompt,
    },
  ]

  const encoder = new TextEncoder()

  // Return a stream that sends keepalive whitespace while Bedrock processes,
  // then delivers the actual content. This prevents Vercel/browser timeout.
  return new ReadableStream({
    async start(controller) {
      // Start keepalive heartbeat (sends a space every 3s to keep connection alive)
      let bedrockDone = false
      const heartbeat = setInterval(() => {
        if (!bedrockDone) {
          try {
            controller.enqueue(encoder.encode(' '))
          } catch { /* stream may be closed */ }
        }
      }, 3000)

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            messages: bedrockMessages,
            system: systemPrompt,
            inferenceConfig: {
              maxTokens,
              temperature,
            },
          }),
        })

        bedrockDone = true
        clearInterval(heartbeat)

        if (!response.ok) {
          const errorText = await response.text()
          console.error('[Bedrock] API error:', {
            status: response.status,
            modelId: model.id,
            error: errorText.substring(0, 200),
          })
          controller.enqueue(encoder.encode(`[Error: Bedrock API failed (${response.status})]`))
          controller.close()
          return
        }

        const data = await response.json()

        const text =
          data?.output?.message?.content
            ?.map((part: { text?: string }) => part.text || '')
            .join('') || ''

        if (!text) {
          console.warn('[Bedrock] Empty response from API')
          controller.close()
          return
        }

        // Deliver content in chunks for progressive rendering
        const CHUNK_SIZE = 100
        let offset = 0
        while (offset < text.length) {
          const end = Math.min(offset + CHUNK_SIZE, text.length)
          controller.enqueue(encoder.encode(text.slice(offset, end)))
          offset = end
        }
        controller.close()
      } catch (err: any) {
        bedrockDone = true
        clearInterval(heartbeat)
        console.error('[Bedrock] Request failed:', err.message)
        controller.enqueue(encoder.encode(`[Error: ${err.message}]`))
        controller.close()
      }
    },
  })
}

export function getModelCost(modelId: string): number {
  const model = AI_MODELS.find((m) => m.id === modelId)
  return model?.costPerMessage || 0
}
