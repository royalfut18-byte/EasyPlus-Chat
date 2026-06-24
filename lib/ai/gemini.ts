import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ChatMessage } from '@/types/models'
import { getInternalModel } from '@/lib/ai/model-routing.server'

/**
 * Stream Gemini response using Google AI Studio API
 */
export async function streamGeminiResponse(
  modelId: string,
  messages: ChatMessage[],
  systemPromptText?: string,
  temperature: number = 0.7,
  maxTokens: number = 16384
): Promise<ReadableStream> {
  const model = getInternalModel(modelId)

  if (!model || !model.geminiModelId) {
    console.error('[Gemini] Unknown model ID or missing geminiModelId:', modelId)
    throw new Error('This EasyPlus tier is unavailable')
  }

  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.error('[Gemini] GEMINI_API_KEY is not set')
    throw new Error('Inference backend is unavailable')
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
    .filter((message) => message.content && message.content.trim())
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

    const finalSystemPrompt = systemPromptText || `You are ${model.name}. You are a helpful assistant.`

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
        maxOutputTokens: maxTokens,
        temperature,
      },
    })

    // Send the last user message, retrying transient overloads. gemini-2.5-flash
    // intermittently returns 503 "high demand" — since this path also serves
    // image reading, retry a few times before giving up.
    let result: Awaited<ReturnType<typeof chat.sendMessage>> | undefined
    let sendError: any
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await chat.sendMessage(lastMessage.parts)
        break
      } catch (err: any) {
        sendError = err
        const message = String(err?.message || '')
        const transient = /\b503\b|UNAVAILABLE|overloaded|high demand|temporarily/i.test(message)
        if (!transient || attempt === 2) throw err
        await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)))
      }
    }
    if (!result) throw sendError || new Error('Gemini returned no response')
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
      throw new Error('This EasyPlus tier is temporarily unavailable. Try again later or switch tiers.')
    }

    // Handle resource exhausted
    if (error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('Resource has been exhausted')) {
      throw new Error('This EasyPlus tier is temporarily unavailable. Try again later or switch tiers.')
    }

    // Handle transient overload (503 "high demand") after retries are exhausted
    if (error.message?.includes('503') || /UNAVAILABLE|overloaded|high demand/i.test(error.message || '')) {
      throw new Error('This EasyPlus tier is busy right now. Please try again in a moment.')
    }

    // Generic error message
    throw new Error('This EasyPlus tier could not respond. Try again or switch tiers.')
  }
}
