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

    // Send the last user message with a model fallback chain. Free-tier Gemini
    // keys hit per-model quota (429) and overload (503) blips; retry transient
    // failures on the primary model, then fall through to the lighter model
    // instead of failing the whole chat.
    const sendWithModel = (modelId: string) => genAI
      .getGenerativeModel({ model: modelId })
      .startChat({
        history,
        systemInstruction: {
          role: 'user',
          parts: [{ text: finalSystemPrompt }],
        },
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
        },
      })
      .sendMessage(lastMessage.parts)

    const fullChain = [model.geminiModelId, ...GEMINI_CHAT_FALLBACK_CHAIN]
      .filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index)
    // Skip models known to be out of quota; if everything is marked dead, still
    // try the most conservative model rather than failing without a request.
    const modelChain = fullChain.filter((id) => !isGeminiQuotaDead(id))
    if (modelChain.length === 0) modelChain.push(fullChain[fullChain.length - 1])

    let result: Awaited<ReturnType<typeof sendWithModel>> | undefined
    let sendError: any
    chain: for (const chainModelId of modelChain) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          result = await sendWithModel(chainModelId)
          if (chainModelId !== fullChain[0]) {
            console.info('[Gemini] Chat fallback model succeeded', { modelId: chainModelId })
          }
          break chain
        } catch (err: any) {
          sendError = err
          const message = String(err?.message || '')
          console.error('[Gemini] sendMessage attempt failed', {
            modelId: chainModelId,
            attempt,
            message: message.slice(0, 200),
          })
          // Out of quota: remember it and move straight to the next model —
          // a retry in one second cannot succeed.
          if (isGeminiQuotaExhausted(message)) {
            markGeminiQuotaDead(chainModelId)
            break
          }
          // Hard errors (bad request, safety block) won't improve on retry or
          // on a smaller model — surface them to the friendly-error mapping.
          if (!isTransientGeminiError(message)) throw err
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1100))
        }
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

/**
 * Use Gemini's vision to read image attachments into a thorough text description,
 * so a text-only model (e.g. DeepSeek) can answer questions about them. Gemini is
 * only the "eyes" — the selected model still writes the actual reply. Returns null
 * if there are no usable images, Gemini isn't configured, or the call fails (the
 * caller then proceeds without image context rather than crashing).
 */
// Vision model fallback chain. Both IDs verified vision-capable on the
// project's key; free-tier Gemini keys hit per-model quota (429) and overload
// (503) blips, so a single-model, single-attempt read regularly failed and the
// chat had to tell the user "couldn't read the image".
const GEMINI_VISION_MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']

// Chat fallback order when a tier's primary Gemini model fails or is out of
// quota: newest fast model first, then the stable flash generations.
const GEMINI_CHAT_FALLBACK_CHAIN = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']

// Free-tier Gemini keys exhaust per-model daily quotas (429 RESOURCE_EXHAUSTED).
// Remember exhausted models for a while so requests skip them instantly instead
// of paying a doomed round-trip each message; retry after the TTL in case the
// quota window has reset.
const GEMINI_QUOTA_DEAD_MS = 10 * 60_000
const geminiQuotaDeadUntil = new Map<string, number>()

function isGeminiQuotaExhausted(message: string): boolean {
  return /\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(message)
}

function markGeminiQuotaDead(modelId: string) {
  geminiQuotaDeadUntil.set(modelId, Date.now() + GEMINI_QUOTA_DEAD_MS)
}

function isGeminiQuotaDead(modelId: string): boolean {
  return (geminiQuotaDeadUntil.get(modelId) || 0) > Date.now()
}

function isTransientGeminiError(message: string): boolean {
  return /\b(429|503)\b|RESOURCE_EXHAUSTED|quota|UNAVAILABLE|overloaded|high demand|temporarily|fetch failed|network|ETIMEDOUT|ECONNRESET/i.test(message)
}

export async function describeImagesForTextModel(
  images: Array<{ dataUrl?: string; mimeType?: string }>,
  userQuestion?: string
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = []
  for (const image of images) {
    if (!image.dataUrl) continue
    const match = image.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match || !match[2]) continue
    imageParts.push({ inlineData: { mimeType: image.mimeType || match[1], data: match[2] } })
  }
  if (imageParts.length === 0) return null

  const instruction = `You are the vision system for another AI assistant that cannot see images. Look at the attached image(s) and write a precise, complete description so that assistant can fully answer the user.
- Transcribe ALL visible text exactly and verbatim — buttons, labels, menus, errors, code, numbers, tables, captions, and fine print.
- Describe the layout, UI elements, diagrams, charts (include their values), photos, and anything visually significant.
- Be objective and thorough. Do NOT answer the user's question yourself; only describe what is in the image.
The user's question about the image is: "${(userQuestion || '').slice(0, 1000) || '(none given)'}"`

  const genAI = new GoogleGenerativeAI(apiKey)
  const fullVisionChain = [process.env.GEMINI_VISION_MODEL, ...GEMINI_VISION_MODEL_CHAIN]
    .filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index)
  const modelChain = fullVisionChain.filter((id) => !isGeminiQuotaDead(id))
  if (modelChain.length === 0) modelChain.push(fullVisionChain[fullVisionChain.length - 1])

  for (const modelId of modelChain) {
    const model = genAI.getGenerativeModel({ model: modelId })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: instruction }, ...imageParts] as any }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        })
        const text = result.response.text()
        if (text && text.trim()) {
          if (modelId !== modelChain[0]) {
            console.info('[Gemini] Vision fallback model succeeded', { modelId })
          }
          return text.trim()
        }
        break // empty response: retrying the same model rarely helps, move on
      } catch (err: any) {
        const message = String(err?.message || '')
        console.error('[Gemini] Vision describe attempt failed', {
          modelId,
          attempt,
          message: message.slice(0, 200),
        })
        if (isGeminiQuotaExhausted(message)) {
          markGeminiQuotaDead(modelId)
          break // quota won't recover in a second — next model immediately
        }
        if (!isTransientGeminiError(message)) break // hard error: next model
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1200))
        // after the retry, fall through to the next model in the chain
      }
    }
  }
  return null
}
