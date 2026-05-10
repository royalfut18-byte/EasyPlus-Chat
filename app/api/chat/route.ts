import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamBedrockResponse, getModelCost } from '@/lib/ai/bedrock'
import { needsWebSearch, searchWeb } from '@/lib/ai/web-search'
import type { ChatMessage } from '@/types/models'

export const runtime = 'nodejs'

type ProfileRow = {
  credits: number
}

export async function POST(request: NextRequest) {
  try {
    console.log('[Chat API] Starting request')

    // Validate environment variables
    const awsToken = process.env.AWS_BEARER_TOKEN_BEDROCK
    const awsRegion = process.env.AWS_REGION
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    console.log('[Chat API] Environment check:', {
      hasAwsToken: !!awsToken,
      awsRegion: awsRegion || 'not set',
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseKey: !!supabaseKey,
    })

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

    console.log('[Chat API] User authenticated:', user.id)

    const { model, messages, conversationId } = await request.json()

    console.log('[Chat API] Request params:', {
      model,
      messageCount: messages?.length,
      conversationId: conversationId || 'none',
    })

    if (!model || !messages || !Array.isArray(messages)) {
      console.error('[Chat API] Invalid request params:', { model, hasMessages: !!messages })
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('credits')
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

    console.log('[Chat API] User credits:', typedProfile.credits)

    const cost = getModelCost(model)

    console.log('[Chat API] Model cost:', cost)

    if (typedProfile.credits < cost) {
      console.warn('[Chat API] Insufficient credits:', {
        userCredits: typedProfile.credits,
        cost,
      })
      return NextResponse.json(
        { error: 'Insufficient credits', credits: typedProfile.credits },
        { status: 402 }
      )
    }

    const { error: updateError } = await db
      .from('profiles')
      .update({ credits: typedProfile.credits - cost })
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[Chat API] Failed to update credits:', updateError)
      throw new Error(`Failed to update credits: ${updateError.message}`)
    }

    const { error: transactionError } = await db.from('credit_transactions').insert({
      user_id: user.id,
      amount: -cost,
      type: 'deduction',
      description: `Message sent using ${model}`,
    })

    if (transactionError) {
      console.error('[Chat API] Failed to create transaction:', transactionError)
      throw new Error(`Failed to create transaction: ${transactionError.message}`)
    }

    console.log('[Chat API] Credits deducted successfully')

    const userMessage = messages[messages.length - 1]
    if (conversationId) {
      const { error: messageError } = await db.from('messages').insert({
        conversation_id: conversationId,
        role: 'user',
        content: userMessage.content,
        model,
      })

      if (messageError) {
        console.error('[Chat API] Failed to insert user message:', messageError)
        throw new Error(`Failed to save user message: ${messageError.message}`)
      }

      console.log('[Chat API] User message saved to DB')
    }

    // Check if web search is needed
    const latestUserMessage = messages[messages.length - 1]
    let messagesToSend = messages as ChatMessage[]

    if (needsWebSearch(latestUserMessage.content)) {
      console.log('[Chat API] Web search needed for query')
      const webContext = await searchWeb(latestUserMessage.content)

      if (webContext) {
        console.log('[Chat API] Web search successful, adding context')
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
      } else {
        console.log('[Chat API] Web search returned no results or is disabled')
      }
    }

    console.log('[Chat API] Calling Bedrock API...')
    const stream = await streamBedrockResponse(model, messagesToSend)
    console.log('[Chat API] Bedrock stream received')

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
          const { error: assistantMessageError } = await db.from('messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: fullResponse,
            model,
          })

          if (assistantMessageError) {
            console.error('Failed to save assistant message:', assistantMessageError)
          }

          const { error: conversationUpdateError } = await db
            .from('conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversationId)

          if (conversationUpdateError) {
            console.error('Failed to update conversation:', conversationUpdateError)
          }
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
