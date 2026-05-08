import { AI_MODELS, type ChatMessage } from '@/types/models'

export async function streamBedrockResponse(
  modelId: string,
  messages: ChatMessage[]
): Promise<ReadableStream> {
  const model = AI_MODELS.find((m) => m.id === modelId)

  if (!model) {
    throw new Error(`Unknown model: ${modelId}`)
  }

  const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK
  const region = process.env.AWS_REGION || 'ap-southeast-2'

  if (!apiKey) {
    throw new Error('Missing AWS_BEARER_TOKEN_BEDROCK')
  }

  const bedrockMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: [{ text: message.content }],
    }))

  const response = await fetch(
    `https://bedrock-runtime.${region}.amazonaws.com/model/${model.bedrockModelId}/converse`,
    {
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
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Bedrock Converse error:', {
      status: response.status,
      modelId: model.bedrockModelId,
      region,
      error: errorText,
    })
    throw new Error(`Bedrock Converse failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()

  const text =
    data?.output?.message?.content
      ?.map((part: { text?: string }) => part.text || '')
      .join('') || ''

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
