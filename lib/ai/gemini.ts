import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS, type ChatMessage } from '@/types/models'

/**
 * Stream Gemini response using Google AI Studio API
 */
export async function streamGeminiResponse(
  modelId: string,
  messages: ChatMessage[],
  artifactMode: boolean = false,
  systemPromptText?: string,
  temperature: number = 0.7
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

  if (process.env.NODE_ENV !== 'production') {
    console.log('[Gemini] Received messages count:', messages.length)
    console.log('[Gemini] First message preview:', messages[0]?.content?.substring(0, 100))
  }

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
          if (attachment.type === 'image' && attachment.dataUrl) {
            try {
              // Extract base64 data from data URL
              const base64Match = attachment.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
              if (base64Match) {
                const mimeType = base64Match[1]
                const base64Data = base64Match[2]

                if (!base64Data) {
                  console.warn('[Gemini] Empty base64 data in attachment')
                  continue
                }

                parts.push({
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                })

                if (process.env.NODE_ENV !== 'production') {
                  console.log('[Gemini] Added image:', {
                    mimeType,
                    dataPreview: base64Data.substring(0, 50) + '...',
                  })
                }
              } else {
                console.warn('[Gemini] Invalid data URL format:', attachment.dataUrl?.substring(0, 50))
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

      // If we have images but no text, add a default prompt
      if (parts.length > 0 && parts.some(p => p.inlineData) && !message.content) {
        parts.push({ text: 'Please analyze this image.' })
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

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Gemini] Using history messages:', history.length)
      console.log('[Gemini] Sending last message with', lastMessage.parts?.length || 0, 'parts')
    }

    const finalSystemPrompt = systemPromptText || `You are ${model.name}, powered by Google. You are a helpful assistant.`

    // Start chat with history and system instruction
    const chat = geminiModel.startChat({
      history,
      systemInstruction: {
        role: 'user',
        parts: [
          {
            text: finalSystemPrompt,
          },
        ],
      },
      generationConfig: {
        maxOutputTokens: 16384,
        temperature,
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

    // Handle quota/rate limit errors gracefully
    if (error.message?.includes('quota') || error.message?.includes('rate limit') || error.message?.includes('429')) {
      throw new Error('Gemini API quota exhausted. Try again later or switch to Claude.')
    }

    // Handle resource exhausted
    if (error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('Resource has been exhausted')) {
      throw new Error('Gemini API quota exhausted. Try again later or switch to Claude.')
    }

    // Generic error message
    throw new Error('Gemini API request failed. Try again or switch to Claude.')
  }
}
