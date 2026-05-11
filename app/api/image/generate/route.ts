import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const runtime = 'nodejs'

type ProfileRow = {
  credits: number
  role: 'user' | 'admin'
  unlimited_credits: boolean
}

type ImageGenerationRequest = {
  prompt: string
  model?: 'nano-banana-2' | 'nano-banana-pro'
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3'
  recentMessages?: Array<{ role: string; content: string }>
  conversationId?: string
}

const IMAGE_MODEL_CONFIG = {
  'nano-banana-2': {
    modelId: 'gemini-2.0-flash-exp',
    cost: 150,
  },
  'nano-banana-pro': {
    modelId: 'gemini-2.0-flash-exp',
    cost: 300,
  },
}

function buildImageGenerationPrompt(request: ImageGenerationRequest): string {
  const { prompt, recentMessages, aspectRatio } = request

  let enrichedPrompt = prompt

  // Add context from recent messages if available
  if (recentMessages && recentMessages.length > 0) {
    const relevantContext = recentMessages
      .slice(-6) // Last 6 messages
      .filter((m) => {
        // Include user prompts and assistant image confirmations
        const content = m.content.toLowerCase()
        return (
          m.role === 'user' ||
          content.includes('generated') ||
          content.includes('image') ||
          content.includes('created')
        )
      })
      .map((m) => {
        // Truncate long messages
        const truncated = m.content.substring(0, 200)
        return `${m.role === 'user' ? 'User' : 'Assistant'}: ${truncated}`
      })
      .join('\n')

    if (relevantContext) {
      enrichedPrompt = `Context from this conversation:
${relevantContext}

Now generate: ${prompt}`
    }
  }

  // Add aspect ratio hint
  if (aspectRatio && aspectRatio !== '1:1') {
    enrichedPrompt += `\n\nAspect ratio: ${aspectRatio}`
  }

  return enrichedPrompt
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY

    if (!apiKey) {
      console.error('[Image Gen] GEMINI_API_KEY is not set')
      return NextResponse.json(
        { error: 'Image generation is not configured' },
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
      console.error('[Image Gen] Auth error:', userError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: ImageGenerationRequest = await request.json()
    const { prompt, model = 'nano-banana-2', aspectRatio = '1:1', recentMessages, conversationId } = body

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('credits, role, unlimited_credits')
      .eq('user_id', user.id)
      .single()

    if (profileError) {
      console.error('[Image Gen] Profile query error:', profileError)
      return NextResponse.json(
        { error: `Profile error: ${profileError.message}` },
        { status: 500 }
      )
    }

    const typedProfile = profile as ProfileRow | null

    if (!typedProfile) {
      console.error('[Image Gen] Profile not found for user:', user.id)
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const modelConfig = IMAGE_MODEL_CONFIG[model]
    const cost = modelConfig.cost

    // Check if user has unlimited credits
    const hasUnlimitedCredits = typedProfile.role === 'admin' || typedProfile.unlimited_credits === true

    if (!hasUnlimitedCredits) {
      if (typedProfile.credits < cost) {
        return NextResponse.json(
          { error: 'Insufficient credits', credits: typedProfile.credits },
          { status: 402 }
        )
      }

      // Deduct credits
      const [updateResult, transactionResult] = await Promise.allSettled([
        db
          .from('profiles')
          .update({ credits: typedProfile.credits - cost })
          .eq('user_id', user.id),
        db.from('credit_transactions').insert({
          user_id: user.id,
          amount: -cost,
          type: 'deduction',
          description: `Image generation using ${model}`,
        }),
      ])

      if (updateResult.status === 'rejected' || (updateResult.value as any).error) {
        console.error('[Image Gen] Failed to update credits:', updateResult)
        throw new Error('Failed to update credits')
      }

      if (transactionResult.status === 'rejected') {
        console.error('[Image Gen] Failed to log transaction (non-critical):', transactionResult)
      }
    }

    // Build enriched prompt with context
    const enrichedPrompt = buildImageGenerationPrompt({
      prompt,
      recentMessages,
      aspectRatio,
    })

    console.log('[Image Gen] Generating image with model:', modelConfig.modelId)

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(apiKey)
    const geminiModel = genAI.getGenerativeModel({ model: modelConfig.modelId })

    // Generate image
    const result = await geminiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: enrichedPrompt }] }],
      generationConfig: {
        temperature: 1.0,
        maxOutputTokens: 8192,
      },
    })

    const response = result.response

    // Check if response contains image data
    if (!response || !response.candidates || response.candidates.length === 0) {
      console.error('[Image Gen] No candidates in response')
      return NextResponse.json({ error: 'No image was returned by the model' }, { status: 500 })
    }

    const candidate = response.candidates[0]
    if (!candidate.content || !candidate.content.parts) {
      console.error('[Image Gen] No parts in candidate')
      return NextResponse.json({ error: 'No image was returned by the model' }, { status: 500 })
    }

    // Find inline data (image) in response
    let imageData: string | null = null
    let mimeType = 'image/png'

    for (const part of candidate.content.parts) {
      if ((part as any).inlineData) {
        const inlineData = (part as any).inlineData
        imageData = inlineData.data
        mimeType = inlineData.mimeType || 'image/png'
        break
      }
    }

    if (!imageData) {
      console.error('[Image Gen] No inline data found in response')
      return NextResponse.json(
        { error: 'The model returned a text response instead of an image. Try a more specific image generation prompt.' },
        { status: 500 }
      )
    }

    // Convert to data URL
    const dataUrl = `data:${mimeType};base64,${imageData}`

    console.log('[Image Gen] Image generated successfully')

    return NextResponse.json({
      success: true,
      image: {
        dataUrl,
        mimeType,
      },
      promptUsed: enrichedPrompt,
      modelUsed: model,
      aspectRatio,
    })
  } catch (error: any) {
    console.error('[Image Gen] Fatal error:', {
      message: error.message,
      stack: error.stack,
    })
    return NextResponse.json(
      { error: error.message || 'Image generation failed' },
      { status: 500 }
    )
  }
}
