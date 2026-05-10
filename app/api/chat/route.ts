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

    const { model, messages, conversationId } = await request.json()

    if (!model || !messages || !Array.isArray(messages)) {
      console.error('[Chat API] Invalid request params')
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
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

    // Check if web search is needed
    const latestUserMessage = messages[messages.length - 1]
    let messagesToSend = messages as ChatMessage[]

    if (needsWebSearch(latestUserMessage.content)) {
      const webContext = await searchWeb(latestUserMessage.content)

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
        messagesToSend = [...messages.slice(0, -1), systemMessage] as ChatMessage[]
      }
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
          // Save user and assistant messages + update conversation in parallel
          await Promise.allSettled([
            db.from('messages').insert({
              conversation_id: conversationId,
              role: 'user',
              content: userMessage.content,
              model,
            }),
            db.from('messages').insert({
              conversation_id: conversationId,
              role: 'assistant',
              content: fullResponse,
              model,
            }),
            db
              .from('conversations')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', conversationId),
          ])
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
