import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamBedrockResponse, getModelCost } from '@/lib/ai/bedrock'
import { streamGeminiResponse } from '@/lib/ai/gemini'
import { searchWeb, buildWebSearchQuery } from '@/lib/ai/web-search'
import { buildSystemPrompt, isTimeSensitiveQuery, detectQueryType } from '@/lib/ai/system-prompt'
import { buildDocumentContext } from '@/lib/ai/document-extract'
import { sanitizeAttachmentsForStorage } from '@/lib/ai/sanitize-attachments'
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
export const maxDuration = 60

type ProfileRow = {
  credits: number
  role: 'user' | 'admin'
  unlimited_credits: boolean
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  let stage = 'init'

  try {
    // Stage: Check env
    stage = 'env-check'
    const awsToken = process.env.AWS_BEARER_TOKEN_BEDROCK

    if (!awsToken) {
      console.error('[Chat API] FATAL: AWS_BEARER_TOKEN_BEDROCK is not set')
      return NextResponse.json(
        { error: 'Server configuration error: AWS_BEARER_TOKEN_BEDROCK missing' },
        { status: 500 }
      )
    }

    // Stage: Auth
    stage = 'auth'
    const supabase = await createClient()
    const db = supabase as any

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      console.error('[Chat API] Auth error:', userError?.message || 'No user')
      return NextResponse.json({ error: 'Unauthorized — please log in again' }, { status: 401 })
    }

    // Stage: Parse body
    stage = 'parse-body'
    let body: any
    try {
      body = await request.json()
    } catch (parseErr: any) {
      console.error('[Chat API] Body parse failed:', parseErr.message)
      return NextResponse.json(
        { error: 'Request body too large or malformed. Try a smaller file.' },
        { status: 400 }
      )
    }

    const { model, messages, conversationId, artifactMode, webSearchEnabled } = body

    if (!model || !messages || !Array.isArray(messages) || messages.length === 0) {
      console.error('[Chat API] Invalid request params:', { model: !!model, messages: Array.isArray(messages), len: messages?.length })
      return NextResponse.json({ error: 'Invalid request: missing model or messages' }, { status: 400 })
    }

    console.log('[Chat API] Request received:', {
      model,
      messageCount: messages.length,
      conversationId: conversationId || 'new',
      artifactMode: !!artifactMode,
      webSearchEnabled: !!webSearchEnabled,
      userId: user.id.substring(0, 8) + '...',
    })

    // Stage: Validate model
    stage = 'validate-model'
    let validatedModel = model
    if (conversationId) {
      const { data: conversation, error: convError } = await db
        .from('conversations')
        .select('model_used')
        .eq('id', conversationId)
        .single()

      if (!convError && conversation) {
        if (conversation.model_used !== model) {
          console.warn('[Chat API] Model mismatch, using conversation model:', conversation.model_used)
          validatedModel = conversation.model_used
        }
      }
    }

    // Stage: Profile
    stage = 'profile'
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('credits, role, unlimited_credits')
      .eq('user_id', user.id)
      .single()

    if (profileError) {
      console.error('[Chat API] Profile query error:', profileError.message)
      return NextResponse.json(
        { error: `Profile error: ${profileError.message}` },
        { status: 500 }
      )
    }

    const typedProfile = profile as ProfileRow | null

    if (!typedProfile) {
      console.error('[Chat API] Profile not found for user:', user.id)
      return NextResponse.json({ error: 'Profile not found. Please contact support.' }, { status: 404 })
    }

    // Stage: Credits
    stage = 'credits'
    const cost = getModelCost(validatedModel)
    const hasUnlimitedCredits = typedProfile.role === 'admin' || typedProfile.unlimited_credits === true

    if (!hasUnlimitedCredits) {
      if (typedProfile.credits < cost) {
        return NextResponse.json(
          { error: 'Insufficient credits', credits: typedProfile.credits },
          { status: 402 }
        )
      }

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
        return NextResponse.json({ error: 'Failed to deduct credits. Please try again.' }, { status: 500 })
      }

      if (transactionResult.status === 'rejected') {
        console.error('[Chat API] Failed to log transaction (non-critical):', transactionResult)
      }
    }

    // Stage: Prepare messages
    stage = 'prepare-messages'
    const userMessage = messages[messages.length - 1]

    // Validate attachment sizes (5MB limit per file)
    if (userMessage.attachments && userMessage.attachments.length > 0) {
      for (const att of userMessage.attachments) {
        if (att.dataUrl && att.dataUrl.length > 7 * 1024 * 1024) {
          return NextResponse.json(
            { error: 'File too large. Please upload a file under 5MB.' },
            { status: 400 }
          )
        }
      }
    }

    // Check image support
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

      console.log('[Chat API] Attachments:', userMessage.attachments.map((a: any) => ({
        type: a.type,
        name: a.name,
        mimeType: a.mimeType,
        size: a.size,
        hasDataUrl: !!a.dataUrl,
      })))
    }

    const isLoadingMarker = (content: string) => {
      return content === '__ARTIFACT_LOADING__' || content === '__ASSISTANT_LOADING__'
    }

    let cleanedMessages = messages
      .filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant')
      .filter((m: ChatMessage) => m.content && !isLoadingMarker(m.content))
      .slice(-16)

    if (cleanedMessages.length === 0) {
      return NextResponse.json({ error: 'No valid messages to process' }, { status: 400 })
    }

    const latestUserMessage = cleanedMessages[cleanedMessages.length - 1]
    let messagesToSend = cleanedMessages as ChatMessage[]

    // Stage: Web search
    stage = 'web-search'
    const shouldSearch = webSearchEnabled === true ||
      (isTimeSensitiveQuery(latestUserMessage.content) && !!process.env.TAVILY_API_KEY)

    let webSearchPerformed = false
    let webSearchFailed = false
    let hasSearchResults = false

    if (shouldSearch) {
      try {
        console.log('[Chat API] Running web search')
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
        }
      } catch (searchErr: any) {
        console.error('[Chat API] Web search error (non-fatal):', searchErr.message)
        webSearchPerformed = true
        webSearchFailed = true
      }
    }

    // Stage: Document extraction
    stage = 'document-extraction'
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
          console.error('[Chat API] Document extraction error:', docErr.message)
          return NextResponse.json(
            { error: `Document processing failed: ${docErr.message}` },
            { status: 400 }
          )
        }
      }
    }

    if (documentContext) {
      const docInstruction: ChatMessage = {
        role: 'user',
        content: `[ATTACHED DOCUMENTS - USE THESE FOR YOUR ANSWER]\n\n${documentContext}\n\n---\nThe above documents are attached by the user. Read and use this content to answer their question. If the document does not contain enough information to answer, say so. Do not invent details not in the document.`,
      }
      messagesToSend = [...messagesToSend.slice(0, -1), docInstruction, latestUserMessage] as ChatMessage[]
    }

    // Stage: Memory
    stage = 'memory'
    let memoryContext = ''
    let memorySaveResult: { saved: boolean; memoryText?: string } | null = null

    try {
      const memories = await getUserMemories(db, user.id, latestUserMessage.content)
      memoryContext = formatMemoriesForPrompt(memories)

      if (shouldExtractMemory(latestUserMessage.content)) {
        const memText = extractMemoryText(latestUserMessage.content)
        if (memText) {
          const result = await saveMemory(db, user.id, memText, conversationId)
          if (result.saved) {
            memorySaveResult = { saved: true, memoryText: memText }
          }
        }
      } else if (isForgetRequest(latestUserMessage.content)) {
        const forgetText = latestUserMessage.content
          .replace(/^(forget|delete|remove)\s+(that|about|my)?\s*/i, '')
          .trim()
        await deleteMemoryByContent(db, user.id, forgetText)
      }
    } catch (memErr: any) {
      console.warn('[Chat API] Memory non-fatal error:', memErr.message)
    }

    // Stage: Route to provider
    stage = 'provider-routing'
    const selectedModel = AI_MODELS.find((m) => m.id === validatedModel)

    if (!selectedModel) {
      console.error('[Chat API] Unknown model after validation:', validatedModel)
      return NextResponse.json(
        { error: `Model "${validatedModel}" is not available. Please start a new chat.` },
        { status: 400 }
      )
    }

    const systemPrompt = buildSystemPrompt({
      model: selectedModel,
      webSearchEnabled: webSearchEnabled === true,
      webSearchPerformed,
      webSearchFailed,
      artifactMode: artifactMode || false,
      hasSearchResults,
      memoryContext,
    })

    const queryType = detectQueryType(latestUserMessage.content)
    const temperature = queryType === 'creative' ? 0.7 : queryType === 'factual' ? 0.3 : 0.4

    // Strip document dataUrls from messages before sending to model
    const messagesForModel = messagesToSend.map((m) => {
      if (!m.attachments) return m
      const imageOnly = m.attachments.filter((a) => a.type === 'image')
      return {
        ...m,
        attachments: imageOnly.length > 0 ? imageOnly : undefined,
      }
    }) as ChatMessage[]

    console.log('[Chat API] Calling provider:', {
      provider: selectedModel.provider,
      modelId: validatedModel,
      bedrockId: selectedModel.bedrockModelId,
      geminiId: selectedModel.geminiModelId,
      messageCount: messagesForModel.length,
      temperature,
    })

    // Stage: Call AI provider
    stage = 'ai-call'
    let stream: ReadableStream

    if (selectedModel.provider === 'google') {
      stream = await streamGeminiResponse(validatedModel, messagesForModel, systemPrompt, temperature)
    } else if (selectedModel.provider === 'anthropic') {
      stream = await streamBedrockResponse(validatedModel, messagesForModel, systemPrompt, temperature)
    } else {
      return NextResponse.json(
        { error: `Provider "${selectedModel.provider}" is not supported` },
        { status: 400 }
      )
    }

    // Stage: Stream response
    stage = 'streaming'
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
          try {
            const { data: maxOrderData } = await db
              .from('messages')
              .select('order_index')
              .eq('conversation_id', conversationId)
              .order('order_index', { ascending: false })
              .limit(1)
              .single()

            const maxOrder = maxOrderData?.order_index || 0
            const nextOrder = (typeof maxOrder === 'number' ? maxOrder : 0) + 1

            const safeAttachments = sanitizeAttachmentsForStorage(userMessage.attachments)
            await db.from('messages').insert({
              conversation_id: conversationId,
              role: 'user',
              content: userMessage.content,
              model: validatedModel,
              order_index: nextOrder,
              ...(safeAttachments ? { attachments: safeAttachments } : {}),
            })

            await db.from('messages').insert({
              conversation_id: conversationId,
              role: 'assistant',
              content: fullResponse,
              model: validatedModel,
              order_index: nextOrder + 1,
            })

            await db
              .from('conversations')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', conversationId)
          } catch (saveErr: any) {
            console.error('[Chat API] Message save error (non-fatal):', saveErr.message)
          }
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

    console.log('[Chat API] Success, streaming response. Duration:', Date.now() - startTime, 'ms')

    return new Response(stream.pipeThrough(transformStream), {
      headers: responseHeaders,
    })
  } catch (error: any) {
    console.error('[Chat API] Fatal error at stage:', stage, {
      message: error.message,
      name: error.name,
      stack: error.stack?.substring(0, 500),
    })
    return NextResponse.json(
      { error: `Chat failed at ${stage}: ${error.message}` },
      { status: 500 }
    )
  }
}
