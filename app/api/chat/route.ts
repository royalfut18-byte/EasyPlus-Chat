import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamBedrockResponse, getModelCost } from '@/lib/ai/bedrock'
import { needsWebSearch, searchWeb } from '@/lib/ai/web-search'
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

    const cost = getModelCost(model)

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
          description: `Message sent using ${model}`,
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

    // Filter and validate conversation context
    const isLoadingMarker = (content: string) => {
      return content === '__ARTIFACT_LOADING__' || content === '__ASSISTANT_LOADING__'
    }

    // Clean messages: filter out loading markers, empty content, non-user/assistant roles
    let cleanedMessages = messages
      .filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant')
      .filter((m: ChatMessage) => m.content && !isLoadingMarker(m.content))
      .slice(-16) // Last 16 messages for reasonable context window

    // Check if web search should be used (manual toggle takes priority)
    const latestUserMessage = cleanedMessages[cleanedMessages.length - 1]
    let messagesToSend = cleanedMessages as ChatMessage[]

    if (webSearchEnabled === true) {
      console.log('[Chat API] Running web search (manual toggle enabled)')

      // Build contextual search query for follow-up questions
      let searchQuery = latestUserMessage.content

      // If this is a short follow-up question, add context from previous messages
      if (latestUserMessage.content.length < 80 && cleanedMessages.length > 1) {
        // Get last few messages for context (up to 3 previous exchanges)
        const recentContext = cleanedMessages
          .slice(-6, -1) // Last 6 messages excluding current
          .map(m => m.content)
          .join(' ')
          .substring(0, 800) // Limit context length

        searchQuery = `${recentContext}\n\nFollow-up: ${latestUserMessage.content}`
        console.log('[Chat API] Using contextual search query for follow-up')
      }

      const webContext = await searchWeb(searchQuery)

      if (webContext) {
        // Prepend system message with web search context
        const systemMessage: ChatMessage = {
          role: 'user',
          content: `[CURRENT WEB SEARCH CONTEXT - Use this to answer the user's question. Cite or mention source URLs when relevant. If the context is insufficient, say you could not verify live data.]

${webContext}

---

User's question: ${latestUserMessage.content}`,
        }

        // Replace the last user message with the enriched version
        messagesToSend = [...cleanedMessages.slice(0, -1), systemMessage] as ChatMessage[]
      } else {
        console.warn('[Chat API] Web search returned no results')
      }
    }

    // Add system instruction for conversation context
    if (messagesToSend.length > 0) {
      const systemInstruction: ChatMessage = {
        role: 'user',
        content: `[SYSTEM INSTRUCTION]
You are EasyPlus AI, a helpful assistant. You are having a conversation with a user.

IMPORTANT CONTEXT RULES:
- Answer using the full conversation history provided above
- For follow-up questions or pronouns (it, that, this, they, he, she), refer to previous messages in this conversation
- Maintain topic continuity unless the user explicitly changes subjects
- If the user asks about "tax" after discussing Jim Chalmers, assume Australian tax policy unless specified otherwise
- If the user says "their squad" after discussing SRH, understand "their" refers to SRH
- Do not randomly switch topics, countries, or contexts
- If web search context conflicts with conversation history, acknowledge both perspectives
- Be conversational and contextually aware

Now continue the conversation naturally:
---`,
      }

      messagesToSend = [systemInstruction, ...messagesToSend]
    }

    const stream = await streamBedrockResponse(model, messagesToSend)

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
            model,
            order_index: nextOrder,
          })

          if (userResult.error) {
            console.error('[Chat API] Failed to save user message:', userResult.error)
          }

          const assistantResult = await db.from('messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: fullResponse,
            model,
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

    return new Response(stream.pipeThrough(transformStream), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
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
