import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateImageWithBedrock } from '@/lib/ai/bedrock-image'

export const runtime = 'nodejs'

type ProfileRow = {
  credits: number
  role: 'user' | 'admin'
  unlimited_credits: boolean
}

type ImageGenerationRequest = {
  prompt: string
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
  numberOfImages?: number
  recentMessages?: Array<{ role: string; content: string }>
  conversationId?: string
}

const IMAGE_GENERATION_COST = 100

function buildImageGenerationPrompt(request: ImageGenerationRequest): string {
  const { prompt, recentMessages, aspectRatio } = request

  let enrichedPrompt = prompt

  // Add context from recent messages if available and relevant
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

  // Add aspect ratio hint for better composition
  if (aspectRatio && aspectRatio !== '1:1') {
    enrichedPrompt += `\n\nAspect ratio: ${aspectRatio}`
  }

  return enrichedPrompt
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
      console.error('[Image Gen] Auth error:', userError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: ImageGenerationRequest = await request.json()
    const {
      prompt,
      aspectRatio = '1:1',
      numberOfImages = 1,
      recentMessages,
      conversationId,
    } = body

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

    const cost = IMAGE_GENERATION_COST

    // Check if user has unlimited credits
    const hasUnlimitedCredits =
      typedProfile.role === 'admin' || typedProfile.unlimited_credits === true

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
          description: 'Image generation using Bedrock Titan v2',
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

    console.log('[Image Gen] Generating with Bedrock Titan v2')
    console.log('[Image Gen] Aspect ratio:', aspectRatio)

    // Generate image using Bedrock Titan
    const result = await generateImageWithBedrock({
      prompt: enrichedPrompt,
      aspectRatio,
      numberOfImages,
    })

    if (!result.images || result.images.length === 0) {
      console.error('[Image Gen] No images returned')
      return NextResponse.json({ error: 'No images were generated' }, { status: 500 })
    }

    console.log('[Image Gen] Successfully generated', result.images.length, 'image(s)')

    // Return first image (can support multiple later)
    return NextResponse.json({
      success: true,
      image: result.images[0],
      promptUsed: enrichedPrompt,
      modelUsed: 'bedrock-titan-v2',
      aspectRatio,
    })
  } catch (error: any) {
    console.error('[Image Gen] Fatal error:', {
      message: error.message,
      stack: error.stack?.substring(0, 300),
    })

    // Return clean user-facing error
    return NextResponse.json(
      { error: error.message || 'Image generation failed. Please try again.' },
      { status: 500 }
    )
  }
}
