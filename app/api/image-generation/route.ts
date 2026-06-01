import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { generateImage, isNvidiaImageAvailable } from '@/lib/ai/nvidia-image.server'
import { getInternalModel } from '@/lib/ai/model-routing.server'
import { getR2ConfigStatus, uploadObjectToR2 } from '@/lib/storage/r2'

export const runtime = 'nodejs'
export const maxDuration = 300

function getImageUrl(storageKey: string, filename: string, download = false): string {
  const params = new URLSearchParams({
    key: storageKey,
    name: filename,
    mimeType: 'image/png',
  })
  if (download) params.set('download', '1')
  return `/api/attachments/file?${params.toString()}`
}

export async function POST(request: NextRequest) {
  try {
    const r2Config = getR2ConfigStatus()
    if (!r2Config.configured) {
      console.error('[Image Generation API] Missing storage env', { missing: r2Config.missing })
      return NextResponse.json({ error: 'Image storage is temporarily unavailable.' }, { status: 503 })
    }

    const supabase = await createClient()
    const db = await createServiceClient() as any
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const entitlement = await getAccountEntitlement(db, user.id)
    const entitlementBlock = getEntitlementBlockResponse(entitlement)
    if (entitlementBlock) return entitlementBlock

    const body = await request.json()
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const aspectRatio = typeof body.aspectRatio === 'string' ? body.aspectRatio : '1:1'
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null
    const projectId = typeof body.projectId === 'string' ? body.projectId : null

    if (!prompt) {
      return NextResponse.json({ error: 'Please describe the image you want to create.' }, { status: 400 })
    }

    const imageModel = getInternalModel('image-generation')
    if (!imageModel || !isNvidiaImageAvailable()) {
      console.error('[Image Generation API] Image provider is not configured')
      return NextResponse.json({ error: 'Image Generation is temporarily unavailable.' }, { status: 503 })
    }

    if (projectId) {
      const { data: project } = await db
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .limit(1)
        .single()
      if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    }

    if (conversationId) {
      const { data: conversation } = await db
        .from('conversations')
        .select('id, project_id')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .limit(1)
        .single()
      if (!conversation) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
      if ((conversation.project_id || null) !== projectId) {
        return NextResponse.json({ error: 'Project does not match this conversation.' }, { status: 403 })
      }
    }

    const costPerImage = imageModel.costPerMessage
    if (!entitlement!.unlimitedCredits && entitlement!.credits < costPerImage) {
      return NextResponse.json({ error: 'Insufficient credits for image generation.' }, { status: 402 })
    }

    const imageResponse = await generateImage({ prompt, aspectRatio })
    const filename = `easyplus-image-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.png`
    const storageKey = `uploads/${user.id}/generated-images/${randomUUID()}/${filename}`
    await uploadObjectToR2({
      key: storageKey,
      body: Buffer.from(imageResponse.imageData, 'base64'),
      mimeType: imageResponse.mimeType,
    })

    if (!entitlement!.unlimitedCredits) {
      await db
        .from('profiles')
        .update({ credits: entitlement!.credits - costPerImage })
        .eq('user_id', user.id)

      await db.from('credit_transactions').insert({
        user_id: user.id,
        amount: -costPerImage,
        type: 'deduction',
        description: 'Image generation',
      })
    }

    return NextResponse.json({
      success: true,
      imageId: randomUUID(),
      imageUrl: getImageUrl(storageKey, filename),
      downloadUrl: getImageUrl(storageKey, filename, true),
      filename,
      mimeType: imageResponse.mimeType,
      sizeBytes: imageResponse.sizeBytes,
      format: imageResponse.format,
      creditsUsed: costPerImage,
      creditsRemaining: entitlement!.unlimitedCredits
        ? -1
        : Math.max(0, entitlement!.credits - costPerImage),
    })
  } catch (error: any) {
    console.error('[Image Generation API] Failed:', error?.message || 'Unknown error')
    const safeMessage = error instanceof Error && /^(Image prompt|Image Generation|Image generation)/.test(error.message)
      ? error.message
      : 'Image Generation is temporarily unavailable.'
    return NextResponse.json({ error: safeMessage }, { status: 500 })
  }
}
