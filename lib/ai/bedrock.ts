import { AI_MODELS, type ChatMessage } from '@/types/models'

export async function streamBedrockResponse(
  modelId: string,
  messages: ChatMessage[]
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

      // Add images if present
      if (message.attachments && message.attachments.length > 0) {
        for (const attachment of message.attachments) {
          if (attachment.type === 'image') {
            // Extract base64 data from data URL
            const base64Match = attachment.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
            if (base64Match) {
              const mimeType = base64Match[1]
              const base64Data = base64Match[2]

              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: base64Data,
                },
              })
            }
          }
        }
      }

      // Add text content
      if (message.content) {
        content.push({ text: message.content })
      }

      return {
        role: message.role,
        content: content.length > 0 ? content : [{ text: message.content || '' }],
      }
    })

  const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${model.bedrockModelId}/converse`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages: bedrockMessages,
      inferenceConfig: {
        maxTokens: 16384,
        temperature: 0.7,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Bedrock] API error:', {
      status: response.status,
      modelId: model.id,
      error: errorText.substring(0, 200),
    })

    throw new Error(
      `Bedrock API failed (${response.status}): ${errorText.substring(0, 200)}`
    )
  }

  const data = await response.json()

  const text =
    data?.output?.message?.content
      ?.map((part: { text?: string }) => part.text || '')
      .join('') || ''

  if (!text) {
    console.warn('[Bedrock] Empty response from API')
  }

  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

export function getModelCost(modelId: string): number {
  const model = AI_MODELS.find((m) => m.id === modelId)
  return model?.costPerMessage || 0
}
