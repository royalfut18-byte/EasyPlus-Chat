import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS, type ChatMessage } from '@/types/models'

/**
 * Stream Gemini response using Google AI Studio API
 */
export async function streamGeminiResponse(
  modelId: string,
  messages: ChatMessage[]
): Promise<ReadableStream> {
  const model = AI_MODELS.find((m) => m.id === modelId)

  if (!model || !model.geminiModelId) {
    console.error('[Gemini] Unknown model ID or missing geminiModelId:', modelId)
    throw new Error(`Unknown Gemini model: ${modelId}`)
  }

  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.error('[Gemini] GEMINI_API_KEY is not set')
    throw new Error('Gemini API key is not configured')
  }

  // Initialize Gemini
  const genAI = new GoogleGenerativeAI(apiKey)
  const geminiModel = genAI.getGenerativeModel({ model: model.geminiModelId })

  // Convert messages to Gemini format
  // Gemini uses a flat array of {role, parts} where role is 'user' or 'model'
  const geminiMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => {
      // Filter out loading markers
      const isLoadingMarker =
        message.content === '__ARTIFACT_LOADING__' || message.content === '__ASSISTANT_LOADING__'
      return message.content && !isLoadingMarker
    })
    .map((message) => {
      const parts: any[] = []

      // Add images if present (Gemini format)
      if (message.attachments && message.attachments.length > 0) {
        for (const attachment of message.attachments) {
          if (attachment.type === 'image') {
            try {
              // Extract base64 data from data URL
              const base64Match = attachment.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
              if (base64Match) {
                const mimeType = base64Match[1]
                const base64Data = base64Match[2]

                parts.push({
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                })

                if (process.env.NODE_ENV !== 'production') {
                  console.log('[Gemini] Added image:', {
                    mimeType,
                    hasData: !!base64Data,
                  })
                }
              }
            } catch (error: any) {
              console.error('[Gemini] Failed to process image:', error.message)
            }
          }
        }
      }

      // Add text content
      if (message.content && message.content.trim()) {
        parts.push({ text: message.content })
      }

      // Ensure we always have at least one part
      if (parts.length === 0) {
        parts.push({ text: message.content || '' })
      }

      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts,
      }
    })

  // Gemini chat requires alternating user/model messages
  // If the last message is from model, we need to add a user message
  // If first message is from model, we need to prepend a user message
  if (geminiMessages.length > 0) {
    if (geminiMessages[0].role === 'model') {
      geminiMessages.unshift({
        role: 'user',
        parts: [{ text: 'Hello' }],
      })
    }
    if (geminiMessages[geminiMessages.length - 1].role === 'model') {
      geminiMessages.push({
        role: 'user',
        parts: [{ text: 'Continue' }],
      })
    }
  }

  try {
    // Build chat history (all messages except the last user message)
    const history = geminiMessages.slice(0, -1)
    const lastMessage = geminiMessages[geminiMessages.length - 1]

    if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error('Last message must be from user')
    }

    // Start chat with history
    const chat = geminiModel.startChat({
      history,
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.7,
      },
    })

    // Send the last user message
    const result = await chat.sendMessage(lastMessage.parts)
    const response = result.response
    const text = response.text()

    if (!text) {
      console.warn('[Gemini] Empty response from API')
    }

    // Return as a ReadableStream
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      },
    })
  } catch (error: any) {
    console.error('[Gemini] API error:', {
      message: error.message,
      stack: error.stack,
    })

    throw new Error(`Gemini API failed: ${error.message}`)
  }
}
