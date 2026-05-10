import { AI_MODELS, type ChatMessage } from '@/types/models'

export async function streamBedrockResponse(
  modelId: string,
  messages: ChatMessage[]
): Promise<ReadableStream> {
  console.log('[Bedrock] streamBedrockResponse called with model:', modelId)

  const model = AI_MODELS.find((m) => m.id === modelId)

  if (!model) {
    console.error('[Bedrock] Unknown model ID:', modelId)
    console.error('[Bedrock] Available models:', AI_MODELS.map((m) => m.id))
    throw new Error(`Unknown model: ${modelId}`)
  }

  const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK
  const region = process.env.AWS_REGION || 'ap-southeast-2'

  console.log('[Bedrock] Configuration:', {
    modelId: model.id,
    bedrockModelId: model.bedrockModelId,
    region,
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey?.length,
    messageCount: messages.length,
  })

  if (!apiKey) {
    console.error('[Bedrock] FATAL: AWS_BEARER_TOKEN_BEDROCK is not set')
    throw new Error('Missing AWS_BEARER_TOKEN_BEDROCK')
  }

  const bedrockMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: [{ text: message.content }],
    }))

  const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${model.bedrockModelId}/converse`

  console.log('[Bedrock] Making request to:', endpoint)
  console.log('[Bedrock] Payload:', {
    messagesCount: bedrockMessages.length,
    inferenceConfig: { maxTokens: 16384, temperature: 0.7 },
  })

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

  console.log('[Bedrock] Response status:', response.status, response.statusText)

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Bedrock] API error:', {
      status: response.status,
      statusText: response.statusText,
      modelId: model.id,
      bedrockModelId: model.bedrockModelId,
      region,
      endpoint,
      errorBody: errorText,
    })

    // Try to parse error JSON if possible
    try {
      const errorJson = JSON.parse(errorText)
      console.error('[Bedrock] Parsed error:', errorJson)
    } catch {
      console.error('[Bedrock] Raw error text:', errorText)
    }

    throw new Error(
      `Bedrock API failed (${response.status}): ${errorText.substring(0, 200)}`
    )
  }

  const data = await response.json()

  console.log('[Bedrock] Response structure:', {
    hasOutput: !!data?.output,
    hasMessage: !!data?.output?.message,
    hasContent: !!data?.output?.message?.content,
    contentLength: data?.output?.message?.content?.length,
  })

  const text =
    data?.output?.message?.content
      ?.map((part: { text?: string }) => part.text || '')
      .join('') || ''

  console.log('[Bedrock] Extracted text length:', text.length)

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
