import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { streamBedrockResponse, getModelCost } from '@/lib/ai/bedrock'
import { streamGeminiResponse } from '@/lib/ai/gemini'
import { streamAzureDeepSeekResponse } from '@/lib/ai/azure-deepseek.server'
import { searchWeb, buildWebSearchQuery } from '@/lib/ai/web-search'
import { buildSystemPrompt, isTimeSensitiveQuery, detectQueryType } from '@/lib/ai/system-prompt'
import { buildDocumentContext, isComprehensiveDocumentRequest } from '@/lib/ai/document-extract'
import { parsePageRangeRequest, parseQuestionNumberRequest } from '@/lib/ai/document-requests'
import { compactPreview, extractQuestionNumberExcerpt } from '@/lib/ai/document-question-retrieval'
import { ocrAttachmentPages, findLatestPdfAttachmentForOcr } from '@/lib/ai/pdf-ocr'
import { sanitizeAttachmentsForStorage } from '@/lib/ai/sanitize-attachments'
import { sanitizeDatabaseText } from '@/lib/supabase/sanitize-db-text'
import { hydrateImageAttachmentsForModel } from '@/lib/ai/image-attachments'
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
import type { ChatMessage, ReasoningMode } from '@/types/models'
import { getInternalModel, getPublicModelName, isChatModelAvailable, toPublicModelId } from '@/lib/ai/model-routing.server'
import { getReasoningProfile, getReasoningSystemAddendum, type ReasoningProfile } from '@/lib/ai/reasoning-profiles'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { createProjectMemory, getRelevantProjectContext } from '@/lib/projects.server'

export const runtime = 'nodejs'
export const maxDuration = 300

function sanitizeIdentityLeak(text: string, publicModelName: string): string {
  if (!text) return text

  const hasIdentityContext =
    /\b(my\s+)?(actual|real|underlying|backend|base)\s+(model|engine|provider)\b/i.test(text) ||
    /\b(engine|model)\s+behind\s+(this|it)\b/i.test(text) ||
    /\bjust\s+the\s+name\s+of\s+the\s+(interface|assistant|ui)\b/i.test(text) ||
    /\bnot\s+(openai|chatgpt|google|gemini|claude)\b/i.test(text)

  const hasForbiddenInternalDetail =
    /\b(azure|openai|anthropic|haiku|sonnet|gemini[-\s]?2\.5|google\s+ai|bedrock)\b/i.test(text) ||
    /azureml:\/\/|openai\.azure\.com|services\.ai\.azure\.com/i.test(text)

  const hasProviderDisclosure =
    hasForbiddenInternalDetail ||
    /\bclaude\b/i.test(text) && publicModelName !== 'Claude Opus 4.8'

  const looksLikeIdentityLeak = hasForbiddenInternalDetail || (hasIdentityContext && hasProviderDisclosure)
  if (!looksLikeIdentityLeak) return text

  return `I am ${publicModelName}. Backend routing details are not exposed.`
}

function createIdentityLeakStreamSanitizer(publicModelName: string) {
  const overlapChars = 260
  let carry = ''

  return {
    push(chunk: string) {
      if (!chunk) return ''
      if (!carry && chunk.trim() === '') return chunk

      const combined = carry + chunk
      if (combined.length <= overlapChars) {
        carry = combined
        return ''
      }

      const emitLength = combined.length - overlapChars
      const emit = combined.slice(0, emitLength)
      carry = combined.slice(emitLength)
      return sanitizeIdentityLeak(emit, publicModelName)
    },
    flush() {
      const remaining = carry
      carry = ''
      return sanitizeIdentityLeak(remaining, publicModelName)
    },
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  let stage = 'init'

  try {
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

    const { model, messages, conversationId, artifactMode, webSearchEnabled, reasoningMode: rawReasoningMode, requestId, clientMessageId } = body
    const reasoningMode: ReasoningMode = ['instant', 'thinking', 'extended'].includes(rawReasoningMode) ? rawReasoningMode : 'thinking'
    const reasoningProfile = getReasoningProfile(reasoningMode)

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
      reasoningMode,
      maxTokens: reasoningProfile.maxTokens,
      requestId: requestId || 'none',
      userId: user.id.substring(0, 8) + '...',
    })

    // Stage: Validate model
    stage = 'validate-model'
    let validatedModel = toPublicModelId(model)
    let conversationProjectId: string | null = null
    if (conversationId) {
      const { data: conversation, error: convError } = await db
        .from('conversations')
        .select('model_used, project_id')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .single()

      if (convError || !conversation) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      }

      const conversationModel = toPublicModelId(conversation.model_used)
      conversationProjectId = conversation.project_id || null
      if (conversationModel !== validatedModel) {
        console.warn('[Chat API] Model mismatch, using conversation model:', conversationModel)
        validatedModel = conversationModel
      }
    }

    if (!getInternalModel(validatedModel) || !isChatModelAvailable(validatedModel)) {
      return NextResponse.json({ error: 'Model is not available' }, { status: 400 })
    }

    // Stage: Profile
    stage = 'profile'
    const entitlement = await getAccountEntitlement(db, user.id)
    const entitlementBlock = getEntitlementBlockResponse(entitlement)
    if (entitlementBlock) return entitlementBlock

    // Stage: Credits
    stage = 'credits'
    const cost = getModelCost(validatedModel)
    const hasUnlimitedCredits = entitlement!.unlimitedCredits

    if (!hasUnlimitedCredits) {
      if (entitlement!.credits < cost) {
        return NextResponse.json(
          { error: 'Insufficient credits', credits: entitlement!.credits },
          { status: 402 }
        )
      }

      const [updateResult, transactionResult] = await Promise.allSettled([
        db
          .from('profiles')
          .update({ credits: entitlement!.credits - cost })
          .eq('user_id', user.id),
        db.from('credit_transactions').insert({
          user_id: user.id,
          amount: -cost,
          type: 'deduction',
          description: `Message sent using ${getPublicModelName(validatedModel)}`,
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
    const normalizedMessages = messages.map((message: ChatMessage) => ({
      ...message,
      content: sanitizeDatabaseText(message.content),
    }))
    const userMessage = normalizedMessages[normalizedMessages.length - 1]
    const currentMessageAttachmentsCount = userMessage.attachments?.length || 0

    // Validate inline attachment sizes (R2 metadata attachments bypass this check)
    if (userMessage.attachments && userMessage.attachments.length > 0) {
      for (const att of userMessage.attachments) {
        const legacyAtt = att as any
        const isR2 = att.storageProvider === 'r2' || legacyAtt.storage_provider === 'r2' || att.storageKey || legacyAtt.storage_key || att.storagePath
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
        const selectedModelCheck = getInternalModel(validatedModel)
        const modelSupportsImages = selectedModelCheck?.provider === 'anthropic' || selectedModelCheck?.provider === 'google'

        if (!modelSupportsImages) {
          return NextResponse.json(
            { error: 'Image input is not supported for this tier. Try another EasyPlus tier.' },
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

    const messageHistoryLimit = reasoningMode === 'instant' ? 8 : reasoningMode === 'extended' ? 30 : 20
    let cleanedMessages = normalizedMessages
      .filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant')
      .filter((m: ChatMessage) => m.content && !isLoadingMarker(m.content))
      .slice(-messageHistoryLimit)

    if (cleanedMessages.length === 0) {
      return NextResponse.json({ error: 'No valid messages to process' }, { status: 400 })
    }

    const latestUserMessage = cleanedMessages[cleanedMessages.length - 1]
    let messagesToSend = cleanedMessages as ChatMessage[]
    const detectedQuestionNumber = parseQuestionNumberRequest(latestUserMessage.content)

    // Stage: Web search (respect reasoning profile)
    stage = 'web-search'
    const shouldSearch = (webSearchEnabled === true && reasoningProfile.enableWebSearch !== false) ||
      (reasoningProfile.enableWebSearch && isTimeSensitiveQuery(latestUserMessage.content) && !!process.env.TAVILY_API_KEY)

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
    const attachmentProcessingStatuses = new Map<string, string>()
    const currentDocumentFileNames: string[] = []
    const currentDocumentQuestionMatches: string[] = []
    const comprehensiveDocumentRequest = isComprehensiveDocumentRequest(latestUserMessage.content)

    if (userMessage.attachments && userMessage.attachments.length > 0) {
      const docAttachments = userMessage.attachments.filter((a: any) => a.type === 'document')
      if (docAttachments.length > 0) {
        try {
          const result = await buildDocumentContext(docAttachments, {
            comprehensive: comprehensiveDocumentRequest,
          })
          documentContext = result.context
          for (const [name, text] of result.extractedTexts) {
            extractedDocTexts.set(name, text)
          }
          for (const [name, status] of result.attachmentStatuses) {
            attachmentProcessingStatuses.set(name, status)
          }
          if (detectedQuestionNumber) {
            for (const [name, text] of result.extractedTexts) {
              const questionMatch = extractQuestionNumberExcerpt(text, detectedQuestionNumber)
              if (questionMatch) {
                currentDocumentQuestionMatches.push(
                  `[Exact match for question ${detectedQuestionNumber} from ${name}]\n${questionMatch.excerpt}`
                )
              }
            }
            if (currentDocumentQuestionMatches.length > 0) {
              documentContext += `\n\n[TARGETED QUESTION MATCHES]\n${currentDocumentQuestionMatches.join('\n\n')}\n[/TARGETED QUESTION MATCHES]`
            }
          }
          if (result.error) {
            console.warn('[Chat API] Document extraction warning:', result.error)
          }
          currentDocumentFileNames.push(...docAttachments.map((att: any) => att.name).filter(Boolean))
          console.log('[Chat API] Document context extracted:', {
            length: documentContext.length,
            comprehensiveDocumentRequest,
            detectedQuestionNumber,
            targetedMatches: currentDocumentQuestionMatches.map((match) => compactPreview(match)),
          })
        } catch (docErr: any) {
          console.error('[Chat API] Document extraction error:', docErr.message)
          return NextResponse.json(
            { error: `Document processing failed: ${docErr.message}` },
            { status: 400 }
          )
        }
      }
    }

    // Reconstruct context from historical messages that had attachments (skip in instant mode)
    let historicalAttachmentContext = ''
    if (reasoningMode !== 'instant') {
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
6. If values seem unclear or corrupted, re-check the source before calculating.
7. If any attached document says extraction failed, OCR is needed, or content was truncated, do NOT claim you extracted every item from that file. State the limitation.
8. For "extract all/every" requests, only include items actually present in the supplied document text. Never fill gaps from memory or likely past exam patterns.`,
      }
      messagesToSend = [...messagesToSend.slice(0, -1), docInstruction, latestUserMessage] as ChatMessage[]
    } else if (historicalAttachmentContext) {
      const historyInstruction: ChatMessage = {
        role: 'user',
        content: `[CONTEXT FROM EARLIER IN THIS CONVERSATION]\n\n${historicalAttachmentContext}---\nThe above documents/images were shared earlier in this conversation. Use this context to inform your answer. The user may be asking follow-up questions about this content.`,
      }
      messagesToSend = [...messagesToSend.slice(0, -1), historyInstruction, latestUserMessage] as ChatMessage[]
    }

    // If the user supplied a page range for a previously uploaded scanned PDF,
    // OCR only those pages before context building so the answer can use saved OCR text.
    if (conversationId && !documentContext && reasoningMode !== 'instant') {
      const requestedPages = parsePageRangeRequest(latestUserMessage.content)
      if (requestedPages) {
        try {
          const candidate = await findLatestPdfAttachmentForOcr(db, user.id, conversationId)
          if (candidate?.id) {
            const ocrResult = await ocrAttachmentPages(db, {
              userId: user.id,
              conversationId,
              attachmentId: candidate.id,
              pageStart: requestedPages.pageStart,
              pageEnd: requestedPages.pageEnd,
            })

            if (ocrResult.combinedText) {
              const ocrInstruction: ChatMessage = {
                role: 'user',
                content: `[OCR TEXT FROM SCANNED PDF - USE THIS FOR YOUR ANSWER]\nDocument: ${ocrResult.fileName}\nPages: ${ocrResult.pageStart}-${ocrResult.pageEnd}\n\n${ocrResult.combinedText}\n\n---\nUse this OCR text as document context. If the OCR text is incomplete or does not contain the requested chapter/question, ask for the correct page range.`,
              }
              messagesToSend = [...messagesToSend.slice(0, -1), ocrInstruction, latestUserMessage] as ChatMessage[]
            }
          }
        } catch (ocrErr: any) {
          console.warn('[Chat API] Automatic selected-page OCR skipped:', ocrErr.message)
        }
      }
    }

    // Stage: Memory & Context Building
    // In Instant mode, skip heavy DB queries (memories, cross-conversation, chunks)
    stage = 'memory'
    let memoryContext = ''
    let fullContextPrompt = ''
    let contextDebugInfo: any = null
    let documentDebugLogged = false
    let memorySaveResult: { saved: boolean; memoryText?: string } | null = null

    try {
      if (reasoningMode === 'instant') {
        // INSTANT: Skip all memory/context DB queries for minimum latency
        console.log('[Chat API] Instant mode — skipping memory/context loading')
      } else if (conversationId) {
        const modelData = getInternalModel(validatedModel)
        const builtContext = await buildContext(db, {
          userId: user.id,
          conversationId,
          latestUserMessage: latestUserMessage.content,
          modelProvider: modelData?.provider || 'anthropic',
          maxTokenBudget: reasoningProfile.contextBudget,
          currentMessages: cleanedMessages,
          includeUserMemories: reasoningMode === 'extended',
          projectId: conversationProjectId,
        })
        fullContextPrompt = formatContextForPrompt(builtContext)
        contextDebugInfo = builtContext.debugInfo

        if (conversationProjectId) {
          const projectContext = await getRelevantProjectContext(conversationProjectId, user.id, latestUserMessage.content)
          if (projectContext) {
            fullContextPrompt = fullContextPrompt
              ? `${projectContext}\n\n${fullContextPrompt}`
              : projectContext
          }
        }

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

        // Cross-conversation search only for extended mode
        if (reasoningMode === 'extended') {
          const crossContext = await searchCrossConversationContext(db, user.id, latestUserMessage.content)
          if (crossContext) {
            memoryContext = memoryContext
              ? `${memoryContext}\n\n${crossContext}`
              : crossContext
          }
        }

        console.log('[Chat API] New chat context:', {
          userId: user.id.substring(0, 8),
          latestMessage: latestUserMessage.content.substring(0, 80),
          userMemoriesLoaded: memories.length,
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
          reasoningMode,
          latestUserMessage: latestUserMessage.content.substring(0, 160),
          currentMessageAttachmentsCount,
          historicalAttachmentsLoadedCount: contextDebugInfo?.historicalAttachmentsLoadedCount || 0,
          attachmentChunksLoadedCount: contextDebugInfo?.attachmentChunksLoadedCount || 0,
          attachmentExtractedTextLength: (contextDebugInfo?.attachmentExtractedTextLength || 0) + Array.from(extractedDocTexts.values()).reduce((sum, text) => sum + text.length, 0),
          previousPdfContextInjected: !!contextDebugInfo?.previousPdfContextInjected || !!historicalAttachmentContext,
          fileNamesIncluded: Array.from(new Set(fileNamesIncluded)),
          questionNumberDetected: detectedQuestionNumber || contextDebugInfo?.questionNumberDetected || null,
          matchedChunkIds: contextDebugInfo?.matchedChunkIds || [],
          matchedChunkPreviews: [
            ...(contextDebugInfo?.matchedChunkPreviews || []),
            ...currentDocumentQuestionMatches.map((match) => compactPreview(match)),
          ].slice(0, 8),
        })
        documentDebugLogged = true
      }

      // Defer memory save/delete (skip in instant mode)
      if (reasoningMode !== 'instant') {
        if (shouldExtractMemory(latestUserMessage.content)) {
          const memText = extractMemoryText(latestUserMessage.content)
          if (memText) {
            memorySaveResult = { saved: true, memoryText: memText }
            if (conversationProjectId) {
              createProjectMemory(conversationProjectId, user.id, {
                content: memText,
                title: 'Saved instruction',
                memory_type: 'instruction',
                importance: 4,
                source_type: 'conversation',
                source_id: conversationId || null,
              }).catch((err: any) => {
                console.warn('[Chat API] Deferred project memory save failed:', err.message)
              })
            } else {
              saveMemory(db, user.id, memText, conversationId).catch((err: any) => {
                console.warn('[Chat API] Deferred memory save failed:', err.message)
              })
            }
          }
        } else if (isForgetRequest(latestUserMessage.content)) {
          const forgetText = latestUserMessage.content
            .replace(/^(forget|delete|remove)\s+(that|about|my)?\s*/i, '')
            .trim()
          deleteMemoryByContent(db, user.id, forgetText).catch((err: any) => {
            console.warn('[Chat API] Deferred memory delete failed:', err.message)
          })
        }
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
    const selectedModel = getInternalModel(validatedModel)

    if (!selectedModel) {
      console.error('[Chat API] Unknown model after validation:', validatedModel)
      return NextResponse.json(
        { error: `Model "${validatedModel}" is not available. Please start a new chat.` },
        { status: 400 }
      )
    }

    // Detect long tasks for optimized handling (skip in instant mode)
    const longTask = reasoningMode !== 'instant' && isLongTaskRequest(latestUserMessage.content, userMessage.attachments)
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
    const baseTemp = queryType === 'creative' ? 0.7 : queryType === 'factual' ? 0.3 : 0.4
    const temperature = reasoningMode === 'instant' ? Math.min(baseTemp + 0.1, 0.8) : reasoningMode === 'extended' ? Math.max(baseTemp - 0.1, 0.2) : baseTemp

    // Add reasoning mode addendum to system prompt
    systemPrompt += getReasoningSystemAddendum(reasoningMode)

    // Resolve cloud-stored images into data URLs only for the provider call.
    stage = 'image-attachment-hydration'
    let hydratedMessagesForModel: ChatMessage[]
    try {
      hydratedMessagesForModel = await hydrateImageAttachmentsForModel(messagesToSend as ChatMessage[], user.id)
    } catch (imageErr: any) {
      console.error('[Chat API] Image hydration failed:', imageErr.message)
      return NextResponse.json(
        { error: imageErr.message || 'Image upload could not be prepared for the model.' },
        { status: 400 }
      )
    }

    // Strip document dataUrls from messages before sending to model
    const messagesForModel = hydratedMessagesForModel.map((m) => {
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

          const safeAttachments = sanitizeAttachmentsForStorage(userMessage.attachments, extractedDocTexts, attachmentProcessingStatuses)
          const { data: insertedMsg, error: userInsertError } = await db.from('messages').insert({
            conversation_id: conversationId,
            role: 'user',
            content: sanitizeDatabaseText(userMessage.content),
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
              textContent: sanitizeDatabaseText(att.textContent || extractedDocTexts.get(att.name) || undefined),
              processingStatus: attachmentProcessingStatuses.get(att.name),
              ocrStatus: attachmentProcessingStatuses.get(att.name) === 'needs_ocr' ? 'needs_ocr' : undefined,
              storageProvider: att.storageProvider || (att as any).storage_provider,
              storageKey: att.storageKey || (att as any).storage_key,
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
    let lastSavedLength = 0
    let contentStarted = false
    let streamFinished = false
    let pendingPartialSave: Promise<void> | null = null

    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          // Call AI provider with reasoning-adjusted maxTokens
          let providerStream: ReadableStream
          const maxTokens = reasoningProfile.maxTokens
          const identitySanitizer = createIdentityLeakStreamSanitizer(selectedModel.name)

          if (selectedModel.provider === 'google') {
            providerStream = await streamGeminiResponse(validatedModel, messagesForModel, systemPrompt, temperature, maxTokens)
          } else if (selectedModel.provider === 'anthropic') {
            providerStream = await streamBedrockResponse(validatedModel, messagesForModel, systemPrompt, temperature, maxTokens)
          } else if (selectedModel.provider === 'azure') {
            providerStream = await streamAzureDeepSeekResponse(messagesForModel, systemPrompt, temperature, maxTokens)
          } else {
            controller.enqueue(encoder.encode('Error: This EasyPlus tier is unavailable'))
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
            const outgoingText = identitySanitizer.push(text)
            if (!outgoingText) continue

            // Track actual content (skip keepalive whitespace for DB storage)
            if (!contentStarted) {
              const trimmed = outgoingText.trimStart()
              if (trimmed.length > 0) {
                contentStarted = true
                fullResponse += trimmed
              }
            } else {
              fullResponse += outgoingText
            }

            // Forward sanitized content to client.
            controller.enqueue(encoder.encode(outgoingText))

            // Periodically save partial content for recovery (every 800ms)
            // Each save is awaited sequentially to prevent race conditions
            if (contentStarted && conversationId && assistantMessageId && Date.now() - lastSaveTime > 800) {
              lastSaveTime = Date.now()
              const partialContent = sanitizeDatabaseText(fullResponse)
              if (partialContent.length > lastSavedLength) {
                // Await the previous partial save before starting a new one
                if (pendingPartialSave) {
                  await pendingPartialSave
                }
                lastSavedLength = partialContent.length
                pendingPartialSave = db.from('messages')
                  .update({ content: partialContent, updated_at: new Date().toISOString() })
                  .eq('id', assistantMessageId)
                  .then(({ error: partialErr }: any) => {
                    if (partialErr) console.error('[Chat API] Partial save failed:', partialErr.message)
                  })
                  .catch((e: any) => console.error('[Chat API] Partial save exception:', e.message))
              }
            }
          }

          const finalOutgoingText = identitySanitizer.flush()
          if (finalOutgoingText) {
            if (!contentStarted) {
              const trimmed = finalOutgoingText.trimStart()
              if (trimmed.length > 0) {
                contentStarted = true
                fullResponse += trimmed
              }
            } else {
              fullResponse += finalOutgoingText
            }
            controller.enqueue(encoder.encode(finalOutgoingText))
          }

          // Mark stream as done so no more partial saves can race
          streamFinished = true

          // Wait for any in-flight partial save to complete before final save
          if (pendingPartialSave) {
            await pendingPartialSave
            pendingPartialSave = null
          }

          // Save completed response — this is the authoritative final content
          if (conversationId && assistantMessageId) {
            const finalContent = sanitizeDatabaseText(fullResponse) || '[Empty response]'
            const finalPayload = { content: finalContent, status: 'completed', updated_at: new Date().toISOString() }

            try {
              const { error: saveErr } = await db.from('messages')
                .update(finalPayload)
                .eq('id', assistantMessageId)

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
                console.log('[Chat API] Assistant message saved:', { assistantMessageId, requestId, contentLength: finalContent.length })
              }

              await db.from('conversations')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', conversationId)

              // Background: update conversation summary and save attachment memories
              ;(async () => {
                try {
                  const needsSummary = await shouldUpdateSummary(db, conversationId!, user.id)
                  if (needsSummary) {
                    await updateConversationSummary(db, conversationId!, user.id, finalContent)
                    if (conversationProjectId && latestUserMessage.content.trim().length > 30) {
                      await createProjectMemory(conversationProjectId, user.id, {
                        title: 'Recent project work',
                        content: latestUserMessage.content.substring(0, 500),
                        memory_type: 'task',
                        importance: 2,
                        source_type: 'conversation',
                        source_id: conversationId!,
                      }).catch((err: any) => {
                        console.warn('[Chat API] Project task memory save failed:', err.message)
                      })
                    }
                  }

                  if (latestUserMessage.content.length > 1500 && savedUserMessageId) {
                    await chunkLongMessage(db, user.id, conversationId!, savedUserMessageId, sanitizeDatabaseText(latestUserMessage.content), 'message')
                  }

                  if (userMessage.attachments && userMessage.attachments.length > 0 && savedUserMessageId) {
                    for (const att of userMessage.attachments) {
                      await saveAttachmentMemory(db, user.id, conversationId!, savedUserMessageId, {
                        name: att.name || 'unknown',
                        type: att.type || 'document',
                        mimeType: att.mimeType,
                        textContent: sanitizeDatabaseText(att.textContent || extractedDocTexts.get(att.name) || undefined),
                        processingStatus: attachmentProcessingStatuses.get(att.name),
                        ocrStatus: attachmentProcessingStatuses.get(att.name) === 'needs_ocr' ? 'needs_ocr' : undefined,
                        storageProvider: att.storageProvider || (att as any).storage_provider,
                        storageKey: att.storageKey || (att as any).storage_key,
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
          streamFinished = true

          // Save whatever content we have so far
          if (conversationId && assistantMessageId) {
            if (pendingPartialSave) {
              await pendingPartialSave.catch(() => {})
            }
            const errorContent = sanitizeDatabaseText(fullResponse || `[Error: ${err.message}]`)
            const errorStatus = fullResponse ? 'completed' : 'error'
            try {
              await db.from('messages')
                .update({ content: errorContent, status: errorStatus, updated_at: new Date().toISOString() })
                .eq('id', assistantMessageId)
            } catch {
              // Last resort
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
