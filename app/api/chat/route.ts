import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
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
import { buildContext, formatContextForPrompt, searchCrossConversationContext } from '@/lib/ai/context-builder'
import { shouldUpdateSummary, updateConversationSummary, chunkLongMessage, saveAttachmentMemory } from '@/lib/ai/conversation-summary'
import { isLongTaskRequest, LONG_TASK_SYSTEM_ADDENDUM } from '@/lib/ai/long-task'
import { AI_MODELS } from '@/types/models'
import type { ChatMessage } from '@/types/models'

export const runtime = 'nodejs'
export const maxDuration = 300

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
    const db = await createServiceClient() as any

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

    const { model, messages, conversationId, artifactMode, webSearchEnabled, requestId, clientMessageId } = body

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
      requestId: requestId || 'none',
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
    const currentMessageAttachmentsCount = userMessage.attachments?.length || 0

    // Validate inline attachment sizes (R2 metadata attachments bypass this check)
    if (userMessage.attachments && userMessage.attachments.length > 0) {
      for (const att of userMessage.attachments) {
        const isR2 = att.storageProvider === 'r2' || att.storage_provider === 'r2' || att.storageKey || att.storage_key || att.storagePath
        if (!isR2 && att.dataUrl && att.dataUrl.length > 7 * 1024 * 1024) {
          return NextResponse.json(
            { error: 'Inline attachment too large. For large files, upload through R2 direct upload.' },
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
        storageProvider: a.storageProvider || a.storage_provider || 'inline',
        storageKey: a.storageKey || a.storage_key || null,
      })))
    }

    const isLoadingMarker = (content: string) => {
      return content === '__ARTIFACT_LOADING__' || content === '__ASSISTANT_LOADING__' || content === '__LONG_TASK_LOADING__' || content === '__RECOVERY_POLLING__'
    }

    let cleanedMessages = messages
      .filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant')
      .filter((m: ChatMessage) => m.content && !isLoadingMarker(m.content))
      .slice(-20)

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
    const extractedDocTexts = new Map<string, string>()
    const currentDocumentFileNames: string[] = []

    if (userMessage.attachments && userMessage.attachments.length > 0) {
      const docAttachments = userMessage.attachments.filter((a: any) => a.type === 'document')
      if (docAttachments.length > 0) {
        try {
          const result = await buildDocumentContext(docAttachments)
          documentContext = result.context
          for (const [name, text] of result.extractedTexts) {
            extractedDocTexts.set(name, text)
          }
          if (result.error) {
            console.warn('[Chat API] Document extraction warning:', result.error)
          }
          currentDocumentFileNames.push(...docAttachments.map((att: any) => att.name).filter(Boolean))
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

    // Reconstruct context from historical messages that had attachments
    let historicalAttachmentContext = ''
    const priorMessages = messagesToSend.slice(0, -1)
    for (const msg of priorMessages) {
      if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          if (att.type === 'document' && att.textContent) {
            historicalAttachmentContext += `[Previously attached document: ${att.name}]\n${att.textContent.substring(0, 4000)}\n[/Previously attached document]\n\n`
          } else if (att.type === 'image') {
            historicalAttachmentContext += `[Previously attached image: ${att.name}] (image was shared earlier in this conversation)\n\n`
          }
        }
      }
    }

    if (documentContext) {
      const docInstruction: ChatMessage = {
        role: 'user',
        content: `[ATTACHED DOCUMENTS - USE THESE FOR YOUR ANSWER]\n\n${documentContext}\n\n---\nCRITICAL INSTRUCTIONS for answering from these documents:
1. ALWAYS quote or restate the relevant details from the document first before answering.
2. Use EXACT numbers and values from the document. Do NOT change, simplify, or misread numbers (e.g., \$140, \$25.50, \$752).
3. For multiple choice questions, restate ALL options from the document before answering.
4. Your final answer MUST match exactly one of the listed options.
5. If the document does not contain enough information, say so. Do not invent details.
6. If values seem unclear or corrupted, re-check the source before calculating.`,
      }
      messagesToSend = [...messagesToSend.slice(0, -1), docInstruction, latestUserMessage] as ChatMessage[]
    } else if (historicalAttachmentContext) {
      const historyInstruction: ChatMessage = {
        role: 'user',
        content: `[CONTEXT FROM EARLIER IN THIS CONVERSATION]\n\n${historicalAttachmentContext}---\nThe above documents/images were shared earlier in this conversation. Use this context to inform your answer. The user may be asking follow-up questions about this content.`,
      }
      messagesToSend = [...messagesToSend.slice(0, -1), historyInstruction, latestUserMessage] as ChatMessage[]
    }

    // Stage: Memory & Context Building
    stage = 'memory'
    let memoryContext = ''
    let fullContextPrompt = ''
    let contextDebugInfo: any = null
    let documentDebugLogged = false
    let memorySaveResult: { saved: boolean; memoryText?: string } | null = null

    try {
      // Build comprehensive context from conversation history, memories, and attachments
      if (conversationId) {
        const modelData = AI_MODELS.find(m => m.id === validatedModel)
        const builtContext = await buildContext(db, {
          userId: user.id,
          conversationId,
          latestUserMessage: latestUserMessage.content,
          modelProvider: modelData?.provider || 'anthropic',
          maxTokenBudget: 24000,
          currentMessages: cleanedMessages,
          includeUserMemories: true,
        })
        fullContextPrompt = formatContextForPrompt(builtContext)
        contextDebugInfo = builtContext.debugInfo

        console.log('[Chat API] Context built:', {
          ...builtContext.debugInfo,
          userId: user.id.substring(0, 8),
          conversationId: conversationId?.substring(0, 8),
          latestMessage: latestUserMessage.content.substring(0, 80),
          hasSummary: !!builtContext.conversationSummary,
          summaryLength: builtContext.conversationSummary?.length || 0,
        })
      } else {
        // No conversation yet — load user memories AND search across conversations
        const memories = await getUserMemories(db, user.id, latestUserMessage.content)
        memoryContext = formatMemoriesForPrompt(memories)

        // Cross-conversation search for relevant context
        const crossContext = await searchCrossConversationContext(db, user.id, latestUserMessage.content)
        if (crossContext) {
          memoryContext = memoryContext
            ? `${memoryContext}\n\n${crossContext}`
            : crossContext
        }

        console.log('[Chat API] New chat context:', {
          userId: user.id.substring(0, 8),
          latestMessage: latestUserMessage.content.substring(0, 80),
          userMemoriesLoaded: memories.length,
          crossContextLength: crossContext?.length || 0,
          totalContextLength: memoryContext.length,
        })
      }

      if (process.env.NODE_ENV !== 'production') {
        const fileNamesIncluded = [
          ...currentDocumentFileNames,
          ...(contextDebugInfo?.fileNamesIncluded || []),
        ].filter(Boolean)
        console.log('[Chat API] Document context debug:', {
          conversationId: conversationId || 'new',
          latestUserMessage: latestUserMessage.content.substring(0, 160),
          currentMessageAttachmentsCount,
          historicalAttachmentsLoadedCount: contextDebugInfo?.historicalAttachmentsLoadedCount || 0,
          attachmentChunksLoadedCount: contextDebugInfo?.attachmentChunksLoadedCount || 0,
          attachmentExtractedTextLength: (contextDebugInfo?.attachmentExtractedTextLength || 0) + Array.from(extractedDocTexts.values()).reduce((sum, text) => sum + text.length, 0),
          previousPdfContextInjected: !!contextDebugInfo?.previousPdfContextInjected || !!historicalAttachmentContext,
          fileNamesIncluded: Array.from(new Set(fileNamesIncluded)),
        })
        documentDebugLogged = true
      }

      // Defer memory save/delete - fire-and-forget after getting context
      if (shouldExtractMemory(latestUserMessage.content)) {
        const memText = extractMemoryText(latestUserMessage.content)
        if (memText) {
          memorySaveResult = { saved: true, memoryText: memText }
          saveMemory(db, user.id, memText, conversationId).catch((err: any) => {
            console.warn('[Chat API] Deferred memory save failed:', err.message)
          })
        }
      } else if (isForgetRequest(latestUserMessage.content)) {
        const forgetText = latestUserMessage.content
          .replace(/^(forget|delete|remove)\s+(that|about|my)?\s*/i, '')
          .trim()
        deleteMemoryByContent(db, user.id, forgetText).catch((err: any) => {
          console.warn('[Chat API] Deferred memory delete failed:', err.message)
        })
      }
    } catch (memErr: any) {
      console.warn('[Chat API] Memory/context non-fatal error:', memErr.message)
      if (process.env.NODE_ENV !== 'production' && !documentDebugLogged) {
        console.log('[Chat API] Document context debug:', {
          conversationId: conversationId || 'new',
          latestUserMessage: latestUserMessage.content.substring(0, 160),
          currentMessageAttachmentsCount,
          historicalAttachmentsLoadedCount: 0,
          attachmentChunksLoadedCount: 0,
          attachmentExtractedTextLength: Array.from(extractedDocTexts.values()).reduce((sum, text) => sum + text.length, 0),
          previousPdfContextInjected: !!historicalAttachmentContext,
          fileNamesIncluded: currentDocumentFileNames,
        })
      }
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

    // Detect long tasks for optimized handling
    const longTask = isLongTaskRequest(latestUserMessage.content, userMessage.attachments)
    if (longTask) {
      console.log('[Chat API] Long task detected')
    }

    let systemPrompt = buildSystemPrompt({
      model: selectedModel,
      webSearchEnabled: webSearchEnabled === true,
      webSearchPerformed,
      webSearchFailed,
      artifactMode: artifactMode || false,
      hasSearchResults,
      memoryContext: fullContextPrompt || memoryContext,
    })

    if (longTask) {
      systemPrompt += '\n\n' + LONG_TASK_SYSTEM_ADDENDUM
    }

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

    // Stage: Save user message BEFORE AI call (idempotent via client_message_id)
    stage = 'save-user-message'
    let userMessageOrderIndex: number | null = null
    let savedUserMessageId: string | null = null

    if (conversationId) {
      try {
        // Check if this message was already saved (retry/recovery scenario)
        if (clientMessageId) {
          const { data: existing } = await db
            .from('messages')
            .select('id, order_index')
            .eq('conversation_id', conversationId)
            .eq('client_message_id', clientMessageId)
            .limit(1)
            .single()

          if (existing) {
            console.log('[Chat API] User message already exists (idempotent), reusing:', existing.id)
            savedUserMessageId = existing.id
            userMessageOrderIndex = existing.order_index

            // Check if assistant already responded (full recovery)
            if (requestId) {
              const { data: existingAssistant } = await db
                .from('messages')
                .select('id, content, status')
                .eq('request_id', requestId)
                .eq('role', 'assistant')
                .limit(1)
                .single()

              if (existingAssistant && existingAssistant.content && existingAssistant.status === 'completed') {
                console.log('[Chat API] Response already exists, returning cached')
                const encoder = new TextEncoder()
                const cachedStream = new ReadableStream({
                  start(controller) {
                    controller.enqueue(encoder.encode(existingAssistant.content))
                    controller.close()
                  },
                })
                return new Response(cachedStream, {
                  headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Recovered': 'true' },
                })
              }
            }
          }
        }

        if (!savedUserMessageId) {
          const { data: maxOrderData } = await db
            .from('messages')
            .select('order_index')
            .eq('conversation_id', conversationId)
            .order('order_index', { ascending: false })
            .limit(1)
            .single()

          const maxOrder = maxOrderData?.order_index || 0
          userMessageOrderIndex = (typeof maxOrder === 'number' ? maxOrder : 0) + 1

          const safeAttachments = sanitizeAttachmentsForStorage(userMessage.attachments, extractedDocTexts)
          const { data: insertedMsg, error: userInsertError } = await db.from('messages').insert({
            conversation_id: conversationId,
            role: 'user',
            content: userMessage.content,
            model: validatedModel,
            order_index: userMessageOrderIndex,
            client_message_id: clientMessageId || null,
            request_id: requestId || null,
            status: 'completed',
            ...(safeAttachments ? { attachments: safeAttachments } : {}),
          }).select('id').single()

          if (userInsertError) {
            console.error('[Chat API] User message insert failed:', userInsertError.message)
            return NextResponse.json(
              { error: `Failed to save user message: ${userInsertError.message}` },
              { status: 500 }
            )
          }

          savedUserMessageId = insertedMsg?.id || null
          console.log('[Chat API] User message saved, order_index:', userMessageOrderIndex)
        }

        if (savedUserMessageId && userMessage.attachments && userMessage.attachments.length > 0) {
          for (const att of userMessage.attachments) {
            await saveAttachmentMemory(db, user.id, conversationId, savedUserMessageId, {
              name: att.name || 'unknown',
              type: att.type || 'document',
              mimeType: att.mimeType,
              textContent: att.textContent || extractedDocTexts.get(att.name) || undefined,
              storageProvider: att.storageProvider || att.storage_provider,
              storageKey: att.storageKey || att.storage_key,
              storagePath: att.storagePath,
              bucket: att.bucket,
              url: att.url,
            })
          }
        }
      } catch (saveErr: any) {
        console.error('[Chat API] User message save exception:', saveErr.message)
        return NextResponse.json(
          { error: `Failed to save user message: ${saveErr.message}` },
          { status: 500 }
        )
      }
    }

    console.log('[Chat API] Calling provider:', {
      provider: selectedModel.provider,
      modelId: validatedModel,
      bedrockId: selectedModel.bedrockModelId,
      geminiId: selectedModel.geminiModelId,
      messageCount: messagesForModel.length,
      temperature,
    })

    // Stage: Pre-create assistant message for recovery
    stage = 'ai-call'
    let assistantMessageId: string | null = null
    const assistantOrder = userMessageOrderIndex != null ? userMessageOrderIndex + 1 : 1

    if (conversationId) {
      try {
        const { data: assistantMsg } = await db.from('messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: '',
          model: validatedModel,
          order_index: assistantOrder,
          request_id: requestId || null,
          parent_message_id: savedUserMessageId || null,
          status: 'generating',
        }).select('id').single()

        assistantMessageId = assistantMsg?.id || null
        console.log('[Chat API] Assistant placeholder created:', assistantMessageId)
      } catch (err: any) {
        console.error('[Chat API] Failed to create assistant placeholder:', err.message)
      }
    }

    // Create a streaming response that starts immediately (keeps Vercel alive)
    // and fetches from the AI provider within the stream
    const encoder = new TextEncoder()
    let fullResponse = ''
    let lastSaveTime = Date.now()
    let contentStarted = false

    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          // Call AI provider
          let providerStream: ReadableStream

          if (selectedModel.provider === 'google') {
            providerStream = await streamGeminiResponse(validatedModel, messagesForModel, systemPrompt, temperature)
          } else if (selectedModel.provider === 'anthropic') {
            providerStream = await streamBedrockResponse(validatedModel, messagesForModel, systemPrompt, temperature)
          } else {
            controller.enqueue(encoder.encode('Error: Unsupported provider'))
            controller.close()
            return
          }

          // Read from provider and forward to client
          const reader = providerStream.getReader()
          const providerDecoder = new TextDecoder()

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const text = providerDecoder.decode(value, { stream: true })

            // Track actual content (skip keepalive whitespace for DB storage)
            if (!contentStarted) {
              const trimmed = text.trimStart()
              if (trimmed.length > 0) {
                contentStarted = true
                fullResponse += trimmed
              }
            } else {
              fullResponse += text
            }

            // Always forward to client (including keepalive spaces)
            controller.enqueue(value)

            // Periodically save partial content for recovery
            // SAFETY: Only save if new content is LONGER than what's already saved
            // This prevents race conditions where a partial save overwrites more complete content
            if (contentStarted && conversationId && assistantMessageId && Date.now() - lastSaveTime > 2000) {
              lastSaveTime = Date.now()
              const partialContent = fullResponse
              db.from('messages')
                .select('content')
                .eq('id', assistantMessageId)
                .single()
                .then(({ data: existing }: any) => {
                  const existingLen = existing?.content?.length || 0
                  if (partialContent.length >= existingLen) {
                    return db.from('messages')
                      .update({ content: partialContent, updated_at: new Date().toISOString() })
                      .eq('id', assistantMessageId)
                  }
                  console.warn('[Chat API] BLOCKED partial save: new content shorter than existing', { existingLen, newLen: partialContent.length })
                  return { error: null }
                })
                .then(({ error: partialErr }: any) => {
                  if (partialErr) console.error('[Chat API] Partial save failed:', partialErr.message)
                })
                .catch((e: any) => console.error('[Chat API] Partial save exception:', e.message))
            }
          }

          // Save completed response — must succeed or recovery will see stale generating
          // SAFETY: Never overwrite existing completed content with shorter content
          if (conversationId && assistantMessageId) {
            const finalContent = fullResponse || '[Empty response]'
            const finalPayload = { content: finalContent, status: 'completed', updated_at: new Date().toISOString() }

            try {
              // Check existing content before overwriting
              const { data: existingMsg } = await db.from('messages')
                .select('content, status')
                .eq('id', assistantMessageId)
                .single()

              const existingContent = existingMsg?.content || ''
              const existingIsReal = existingContent.length > 20 &&
                !['__ARTIFACT_LOADING__', '__ASSISTANT_LOADING__', '__LONG_TASK_LOADING__', '__RECOVERY_POLLING__', '...', ''].includes(existingContent.trim())

              // CORRUPTION GUARD: If existing content is longer and already completed, do NOT overwrite
              if (existingIsReal && existingMsg?.status === 'completed' && existingContent.length > finalContent.length) {
                console.error('[Chat API] CORRUPTION GUARD: Blocked final save that would shorten completed content', {
                  assistantMessageId,
                  requestId,
                  existingLength: existingContent.length,
                  newLength: finalContent.length,
                })
              } else {
                // Safe to save: new content is longer or existing is not completed
                const { error: saveErr, data: saveData } = await db.from('messages')
                  .update(finalPayload)
                  .eq('id', assistantMessageId)
                  .select('id, content, status')

                if (saveErr) {
                  console.error('[Chat API] CRITICAL: Final save failed:', saveErr.message, { assistantMessageId, requestId, contentLength: finalContent.length })
                  // Retry once
                  const { error: retryErr } = await db.from('messages')
                    .update(finalPayload)
                    .eq('id', assistantMessageId)
                  if (retryErr) {
                    console.error('[Chat API] CRITICAL: Final save retry also failed:', retryErr.message)
                  } else {
                    console.log('[Chat API] Final save retry succeeded')
                  }
                } else {
                  const savedLen = saveData?.[0]?.content?.length || 0
                  console.log('[Chat API] Assistant message saved:', { assistantMessageId, requestId, contentLength: finalContent.length, savedContentLength: savedLen, status: saveData?.[0]?.status })
                }
              }

              await db.from('conversations')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', conversationId)

              // Background: update conversation summary and save attachment memories
              // Fire-and-forget to not block response delivery
              ;(async () => {
                try {
                  // Update rolling summary if enough messages have accumulated
                  const needsSummary = await shouldUpdateSummary(db, conversationId!, user.id)
                  if (needsSummary) {
                    await updateConversationSummary(db, conversationId!, user.id, finalContent)
                  }

                  // Chunk long user messages for future retrieval
                  if (latestUserMessage.content.length > 1500 && savedUserMessageId) {
                    await chunkLongMessage(db, user.id, conversationId!, savedUserMessageId, latestUserMessage.content, 'message')
                  }

                  // Save attachment context for future retrieval
                  if (userMessage.attachments && userMessage.attachments.length > 0 && savedUserMessageId) {
                    for (const att of userMessage.attachments) {
                      await saveAttachmentMemory(db, user.id, conversationId!, savedUserMessageId, {
                        name: att.name || 'unknown',
                        type: att.type || 'document',
                        mimeType: att.mimeType,
                        textContent: att.textContent || extractedDocTexts.get(att.name) || undefined,
                        storageProvider: att.storageProvider || att.storage_provider,
                        storageKey: att.storageKey || att.storage_key,
                        storagePath: att.storagePath,
                        bucket: att.bucket,
                        url: att.url,
                      })
                    }
                  }
                } catch (bgErr: any) {
                  console.error('[Chat API] Background memory update failed:', bgErr.message)
                }
              })()
            } catch (saveError: any) {
              console.error('[Chat API] CRITICAL: Final save exception:', saveError.message, { assistantMessageId, requestId, contentLength: finalContent.length })
              // Last resort retry
              try {
                await db.from('messages')
                  .update(finalPayload)
                  .eq('id', assistantMessageId)
              } catch (e: any) {
                console.error('[Chat API] CRITICAL: All save attempts exhausted:', e.message)
              }
            }
          }

          controller.close()
        } catch (err: any) {
          console.error('[Chat API] Stream error:', err.message)

          // Save error status so recovery polling knows to stop
          // SAFETY: Never shorten existing completed content on error
          if (conversationId && assistantMessageId) {
            const errorContent = fullResponse || `[Error: ${err.message}]`
            const errorStatus = fullResponse ? 'completed' : 'error'
            try {
              const { data: existingErr } = await db.from('messages')
                .select('content, status')
                .eq('id', assistantMessageId)
                .single()
              const existingErrContent = existingErr?.content || ''
              if (existingErr?.status === 'completed' && existingErrContent.length > errorContent.length && existingErrContent.length > 20) {
                console.warn('[Chat API] CORRUPTION GUARD (error handler): Preserving longer existing content')
              } else {
                await db.from('messages')
                  .update({ content: errorContent, status: errorStatus })
                  .eq('id', assistantMessageId)
              }
            } catch {
              await db.from('messages')
                .update({ content: errorContent, status: errorStatus })
                .eq('id', assistantMessageId)
                .catch(() => {})
            }
          }

          if (fullResponse) {
            controller.close()
          } else {
            controller.enqueue(encoder.encode(`Error: ${err.message}`))
            controller.close()
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

    if (fullContextPrompt || memoryContext) {
      responseHeaders['X-Context-Loaded'] = 'true'
      responseHeaders['X-Context-Length'] = String((fullContextPrompt || memoryContext).length)
    }

    if (longTask) {
      responseHeaders['X-Long-Task'] = 'true'
    }

    if (requestId) {
      responseHeaders['X-Request-Id'] = requestId
    }

    console.log('[Chat API] Streaming response started. Duration:', Date.now() - startTime, 'ms')

    return new Response(responseStream, {
      headers: responseHeaders,
    })
  } catch (error: any) {
    console.error('[Chat API] Fatal error at stage:', stage, {
      message: error.message,
      name: error.name,
      stack: error.stack?.substring(0, 500),
    })

    const isTimeout =
      error.message?.includes('timeout') ||
      error.message?.includes('TIMEOUT') ||
      error.message?.includes('timed out') ||
      error.message?.includes('FUNCTION_INVOCATION_TIMEOUT') ||
      error.name === 'TimeoutError' ||
      (stage === 'ai-call' && Date.now() - startTime > 280000)

    if (isTimeout) {
      return NextResponse.json(
        { error: 'The response timed out. Try saying "continue" or asking for the next part.' },
        { status: 504 }
      )
    }

    return NextResponse.json(
      { error: `Chat failed at ${stage}: ${error.message}` },
      { status: 500 }
    )
  }
}
