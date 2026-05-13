import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamBedrockResponse, getModelCost } from '@/lib/ai/bedrock'
import { streamGeminiResponse } from '@/lib/ai/gemini'
import { needsWebSearch, searchWeb, buildWebSearchQuery } from '@/lib/ai/web-search'
import { buildSystemPrompt, isTimeSensitiveQuery, detectQueryType } from '@/lib/ai/system-prompt'
import { buildDocumentContext } from '@/lib/ai/document-extract'
import {
  getUserMemories,
  formatMemoriesForPrompt,
  shouldExtractMemory,
  isForgetRequest,
  extractMemoryText,
  saveMemory,
  deleteMemoryByContent,
} from '@/lib/ai/memory'
import { AI_MODELS } from '@/types/models'
import type { ChatMessage } from '@/types/models'

export const runtime = 'nodejs'

type ProfileRow = {
  credits: number
  role: 'user' | 'admin'
  unlimited_credits: boolean
}

export async function POST(request: NextRequest) {
  try {
    const awsToken = process.env.AWS_BEARER_TOKEN_BEDROCK

    if (!awsToken) {
      console.error('[Chat API] FATAL: AWS_BEARER_TOKEN_BEDROCK is not set')
      return NextResponse.json(
        { error: 'Server configuration error: AWS_BEARER_TOKEN_BEDROCK missing' },
        { status: 500 }
      )
    }

    const supabase = await createClient()
    const db = supabase as any

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      console.error('[Chat API] Auth error:', userError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { model, messages, conversationId, artifactMode, webSearchEnabled } = await request.json()

    if (!model || !messages || !Array.isArray(messages)) {
      console.error('[Chat API] Invalid request params')
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Validate model matches conversation if conversationId exists
    let validatedModel = model
    if (conversationId) {
      const { data: conversation, error: convError } = await db
        .from('conversations')
        .select('model_used')
        .eq('id', conversationId)
        .single()

      if (!convError && conversation) {
        if (conversation.model_used !== model) {
          console.warn('[Chat API] Model mismatch detected, using conversation model:', conversation.model_used)
          validatedModel = conversation.model_used
        }
      }
    }

    // Log artifact mode (not the content)
    if (artifactMode) {
      console.log('[Chat API] Artifact mode enabled for this request')
    }

    // Log web search mode
    if (webSearchEnabled) {
      console.log('[Chat API] Web search enabled for this request')
    }

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('credits, role, unlimited_credits')
      .eq('user_id', user.id)
      .single()

    if (profileError) {
      console.error('[Chat API] Profile query error:', profileError)
      return NextResponse.json(
        { error: `Profile error: ${profileError.message}` },
        { status: 500 }
      )
    }

    const typedProfile = profile as ProfileRow | null

    if (!typedProfile) {
      console.error('[Chat API] Profile not found for user:', user.id)
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const cost = getModelCost(validatedModel)

    // Check if user has unlimited credits (admin or unlimited_credits flag)
    const hasUnlimitedCredits = typedProfile.role === 'admin' || typedProfile.unlimited_credits === true

    if (!hasUnlimitedCredits) {
      // Normal credit check for regular users
      if (typedProfile.credits < cost) {
        return NextResponse.json(
          { error: 'Insufficient credits', credits: typedProfile.credits },
          { status: 402 }
        )
      }

      // Deduct credits and log transaction in parallel (non-blocking optimizations)
      const [updateResult, transactionResult] = await Promise.allSettled([
        db
          .from('profiles')
          .update({ credits: typedProfile.credits - cost })
          .eq('user_id', user.id),
        db.from('credit_transactions').insert({
          user_id: user.id,
          amount: -cost,
          type: 'deduction',
          description: `Message sent using ${validatedModel}`,
        }),
      ])

      if (updateResult.status === 'rejected' || (updateResult.value as any).error) {
        console.error('[Chat API] Failed to update credits:', updateResult)
        throw new Error('Failed to update credits')
      }

      // Transaction logging is non-critical, just log if it fails but don't block
      if (transactionResult.status === 'rejected') {
        console.error('[Chat API] Failed to log transaction (non-critical):', transactionResult)
      }
    }

    const userMessage = messages[messages.length - 1]

    // Check if user sent images and model doesn't support them
    if (userMessage.attachments && userMessage.attachments.length > 0) {
      const hasImageAttachments = userMessage.attachments.some((a: any) => a.type === 'image')

      if (hasImageAttachments) {
        const selectedModelCheck = AI_MODELS.find((m) => m.id === validatedModel)
        const modelSupportsImages = selectedModelCheck?.provider === 'anthropic' || selectedModelCheck?.provider === 'google'

        if (!modelSupportsImages) {
          return NextResponse.json(
            { error: 'Image input is not supported for this model. Try Claude Opus 4.6 or Gemini.' },
            { status: 400 }
          )
        }
      }
    }

    // Filter and validate conversation context
    const isLoadingMarker = (content: string) => {
      return content === '__ARTIFACT_LOADING__' || content === '__ASSISTANT_LOADING__'
    }

    // Clean messages: filter out loading markers, empty content, non-user/assistant roles
    let cleanedMessages = messages
      .filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant')
      .filter((m: ChatMessage) => m.content && !isLoadingMarker(m.content))
      .slice(-16) // Last 16 messages for reasonable context window

    // Determine if we need search: manual toggle OR auto-detect time-sensitive
    const latestUserMessage = cleanedMessages[cleanedMessages.length - 1]
    let messagesToSend = cleanedMessages as ChatMessage[]
    const shouldSearch = webSearchEnabled === true ||
      (isTimeSensitiveQuery(latestUserMessage.content) && !!process.env.TAVILY_API_KEY)

    let webSearchPerformed = false
    let webSearchFailed = false
    let hasSearchResults = false

    if (shouldSearch) {
      console.log('[Chat API] Running web search', { manual: webSearchEnabled, autoDetected: !webSearchEnabled })

      const searchQuery = buildWebSearchQuery(latestUserMessage.content, cleanedMessages)
      const searchResult = await searchWeb(searchQuery, latestUserMessage.content)

      webSearchPerformed = true
      webSearchFailed = searchResult.failed
      hasSearchResults = searchResult.resultCount > 0

      if (searchResult.context) {
        const searchInstruction: ChatMessage = {
          role: 'user',
          content: `[WEB SEARCH RESULTS - USE THESE FOR YOUR ANSWER]
User's question: "${latestUserMessage.content}"

The following are real search results retrieved just now. Use them to answer the user's question accurately.

${searchResult.context}

---

RULES FOR USING THESE RESULTS:
- Base your answer on these search results for any current/factual claims.
- Cite sources by name and URL when making specific claims.
- If these results do NOT address the user's question, say so honestly. Do not force irrelevant results into your answer.
- Do not invent information beyond what these sources provide.
- Clearly distinguish between what the sources say vs your own analysis.
- If results conflict with each other, note the disagreement.`,
        }

        messagesToSend = [...cleanedMessages.slice(0, -1), searchInstruction, latestUserMessage] as ChatMessage[]
      } else if (searchResult.failed) {
        console.warn('[Chat API] Web search failed')
      } else {
        console.warn('[Chat API] Web search returned no relevant results')
      }
    }

    // Extract document text from attachments in the latest user message
    // Use userMessage (raw from request body) to guarantee attachments are present
    let documentContext = ''
    if (userMessage.attachments && userMessage.attachments.length > 0) {
      const docAttachments = userMessage.attachments.filter((a: any) => a.type === 'document')
      if (docAttachments.length > 0) {
        try {
          const result = await buildDocumentContext(docAttachments)
          documentContext = result.context
          if (result.error) {
            console.warn('[Chat API] Document extraction warning:', result.error)
          }
          console.log('[Chat API] Document context extracted, length:', documentContext.length)
        } catch (docErr: any) {
          console.error('[Chat API] Document extraction error:', docErr.message, docErr.stack)
          return NextResponse.json(
            { error: 'Document processing failed. Please try re-uploading the file.', details: docErr.message },
            { status: 400 }
          )
        }
      }
    }

    // If document context exists, inject it into the messages
    if (documentContext) {
      const docInstruction: ChatMessage = {
        role: 'user',
        content: `[ATTACHED DOCUMENTS - USE THESE FOR YOUR ANSWER]\n\n${documentContext}\n\n---\nThe above documents are attached by the user. Read and use this content to answer their question. If the document does not contain enough information to answer, say so. Do not invent details not in the document.`,
      }
      messagesToSend = [...messagesToSend.slice(0, -1), docInstruction, latestUserMessage] as ChatMessage[]
    }

    // Retrieve long-term memory for this user (non-blocking if table doesn't exist)
    let memoryContext = ''
    let memorySaveResult: { saved: boolean; memoryText?: string } | null = null

    try {
      const memories = await getUserMemories(db, user.id, latestUserMessage.content)
      memoryContext = formatMemoriesForPrompt(memories)

      // Check if user wants to save or forget a memory
      if (shouldExtractMemory(latestUserMessage.content)) {
        const memText = extractMemoryText(latestUserMessage.content)
        if (memText) {
          const result = await saveMemory(db, user.id, memText, conversationId)
          if (result.saved) {
            memorySaveResult = { saved: true, memoryText: memText }
            console.log('[Chat API] Memory saved:', memText.substring(0, 50))
          }
        }
      } else if (isForgetRequest(latestUserMessage.content)) {
        const forgetText = latestUserMessage.content
          .replace(/^(forget|delete|remove)\s+(that|about|my)?\s*/i, '')
          .trim()
        await deleteMemoryByContent(db, user.id, forgetText)
        console.log('[Chat API] Memory deletion attempted for:', forgetText.substring(0, 50))
      }
    } catch (memErr: any) {
      console.warn('[Chat API] Memory retrieval non-fatal error:', memErr.message)
    }

    // Route to appropriate AI provider based on validated model
    const selectedModel = AI_MODELS.find((m) => m.id === validatedModel)

    if (!selectedModel) {
      console.error('[Chat API] Unknown model:', validatedModel)
      return NextResponse.json({ error: 'Unknown model' }, { status: 400 })
    }

    // Build production system prompt (includes memory context)
    const systemPrompt = buildSystemPrompt({
      model: selectedModel,
      webSearchEnabled: webSearchEnabled === true,
      webSearchPerformed,
      webSearchFailed,
      artifactMode: artifactMode || false,
      hasSearchResults,
      memoryContext,
    })

    // Determine temperature based on query type
    const queryType = detectQueryType(latestUserMessage.content)
    const temperature = queryType === 'creative' ? 0.7 : queryType === 'factual' ? 0.3 : 0.4

    // Strip document dataUrls from messages before sending to model (text already extracted above)
    // Keep image dataUrls since models need them for vision
    const messagesForModel = messagesToSend.map((m) => {
      if (!m.attachments) return m
      const cleanedAttachments = m.attachments
        .filter((a) => a.type === 'image')
      return {
        ...m,
        attachments: cleanedAttachments.length > 0 ? cleanedAttachments : undefined,
      }
    }) as ChatMessage[]

    let stream: ReadableStream

    if (selectedModel.provider === 'google') {
      console.log('[Chat API] Using Gemini provider, temp:', temperature)
      stream = await streamGeminiResponse(validatedModel, messagesForModel, systemPrompt, temperature)
    } else if (selectedModel.provider === 'anthropic') {
      console.log('[Chat API] Using Bedrock/Claude provider, temp:', temperature)
      stream = await streamBedrockResponse(validatedModel, messagesForModel, systemPrompt, temperature)
    } else {
      console.error('[Chat API] Unsupported provider:', selectedModel.provider)
      return NextResponse.json(
        { error: `Provider ${selectedModel.provider} is not supported` },
        { status: 400 }
      )
    }

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let fullResponse = ''

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        const text = decoder.decode(chunk)
        fullResponse += text
        controller.enqueue(chunk)
      },
      async flush() {
        if (conversationId && fullResponse) {
          // Get max order_index for this conversation
          const { data: maxOrderData } = await db
            .from('messages')
            .select('order_index')
            .eq('conversation_id', conversationId)
            .order('order_index', { ascending: false })
            .limit(1)
            .single()

          const maxOrder = maxOrderData?.order_index || 0
          const nextOrder = (typeof maxOrder === 'number' ? maxOrder : 0) + 1

          // IMPORTANT: Save user message FIRST, then assistant message
          // User message gets order_index N, assistant gets N+1
          const userResult = await db.from('messages').insert({
            conversation_id: conversationId,
            role: 'user',
            content: userMessage.content,
            model: validatedModel,
            order_index: nextOrder,
          })

          if (userResult.error) {
            console.error('[Chat API] Failed to save user message:', userResult.error)
          }

          const assistantResult = await db.from('messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: fullResponse,
            model: validatedModel,
            order_index: nextOrder + 1,
          })

          if (assistantResult.error) {
            console.error('[Chat API] Failed to save assistant message:', assistantResult.error)
          }

          // Update conversation timestamp
          await db
            .from('conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversationId)
        }
      },
    })

    const responseHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    }

    if (memorySaveResult?.saved) {
      responseHeaders['X-Memory-Saved'] = 'true'
    }

    return new Response(stream.pipeThrough(transformStream), {
      headers: responseHeaders,
    })
  } catch (error: any) {
    console.error('[Chat API] Fatal error:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    })
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
