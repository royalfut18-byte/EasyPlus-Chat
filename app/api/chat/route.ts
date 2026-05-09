import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamBedrockResponse, getModelCost } from '@/lib/ai/bedrock'
import type { ChatMessage } from '@/types/models'

export const runtime = 'edge'

type ProfileRow = {
  credits: number
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const db = supabase as any

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { model, messages, conversationId } = await request.json()

    if (!model || !messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('credits')
      .eq('user_id', user.id)
      .single()

    const typedProfile = profile as ProfileRow | null

    if (!typedProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const cost = getModelCost(model)

    if (typedProfile.credits < cost) {
      return NextResponse.json(
        { error: 'Insufficient credits', credits: typedProfile.credits },
        { status: 402 }
      )
    }

    const { error: updateError } = await db
      .from('profiles')
      .update({ credits: typedProfile.credits - cost })
      .eq('user_id', user.id)

    if (updateError) throw updateError

    const { error: transactionError } = await db.from('credit_transactions').insert({
      user_id: user.id,
      amount: -cost,
      type: 'deduction',
      description: `Message sent using ${model}`,
    })

    if (transactionError) throw transactionError

    const userMessage = messages[messages.length - 1]
    if (conversationId) {
      const { error: messageError } = await db.from('messages').insert({
        conversation_id: conversationId,
        role: 'user',
        content: userMessage.content,
        model,
      })

      if (messageError) throw messageError
    }

    const stream = await streamBedrockResponse(model, messages as ChatMessage[])

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
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
