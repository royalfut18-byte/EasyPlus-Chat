import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { generateAzureImage, isValidAzureImageSize, sanitizeImagePrompt } from '@/lib/ai/azure-image.server'
import { getR2ConfigStatus, uploadObjectToR2 } from '@/lib/storage/r2'

export const runtime = 'nodejs'
export const maxDuration = 300

function safeFileName(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

  return `easyplus-image-${slug || 'generated'}-${Date.now()}.png`
}

function fileUrl(attachmentId: string, download = false): string {
  const params = new URLSearchParams({
    attachmentId,
  })
  if (download) params.set('download', '1')
  return `/api/attachments/file?${params.toString()}`
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const db = await createServiceClient() as any
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const entitlementBlock = getEntitlementBlockResponse(await getAccountEntitlement(db, user.id))
    if (entitlementBlock) return entitlementBlock

    const storageStatus = getR2ConfigStatus()
    if (!storageStatus.configured) {
      console.error('[Image Generation] Storage is not configured', {
        missing: storageStatus.missing,
      })
      return NextResponse.json(
        { error: 'Image Generation is temporarily unavailable.' },
        { status: 503 }
      )
    }

    const body = await request.json().catch(() => null)
    const prompt = sanitizeImagePrompt(body?.prompt)
    const size = body?.size
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null
    const projectId = typeof body?.projectId === 'string' ? body.projectId : null

    if (!prompt || prompt.length < 3) {
      return NextResponse.json({ error: 'Enter a more detailed image prompt.' }, { status: 400 })
    }

    if (!isValidAzureImageSize(size)) {
      return NextResponse.json({ error: 'Unsupported image size.' }, { status: 400 })
    }

    if (conversationId) {
      const { data: conversation } = await db
        .from('conversations')
        .select('id, project_id')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .limit(1)
        .single()

      if (!conversation) {
        return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
      }

      if ((conversation.project_id || null) !== projectId) {
        return NextResponse.json({ error: 'Project does not match this conversation.' }, { status: 403 })
      }
    } else if (projectId) {
      return NextResponse.json({ error: 'Project image generation must belong to a conversation.' }, { status: 400 })
    }

    const generated = await generateAzureImage(prompt, size)
    const imageBuffer = Buffer.from(generated.base64, 'base64')
    const imageId = randomUUID()
    const filename = safeFileName(prompt)
    const storageKey = `uploads/${user.id}/generated-images/${imageId}/${filename}`

    console.info('[Image Generation] Saving generated image to storage', {
      size,
      sizeBytes: generated.sizeBytes,
      storageConfigured: storageStatus.configured,
    })

    try {
      await uploadObjectToR2({
        key: storageKey,
        body: imageBuffer,
        mimeType: generated.mimeType,
      })
    } catch (error: any) {
      console.error('[Image Generation] Storage upload failed after Azure generation', {
        message: error?.message,
        storageConfigured: storageStatus.configured,
      })
      return NextResponse.json(
        { error: 'Image generated but could not be saved.' },
        { status: 503 }
      )
    }

    const { data: attachment, error: attachmentError } = await db
      .from('attachments')
      .insert({
        user_id: user.id,
        conversation_id: conversationId,
        project_id: projectId,
        file_name: filename,
        file_type: 'generated_image',
        mime_type: generated.mimeType,
        storage_path: storageKey,
        processing_status: 'ready',
        purpose_note: 'Generated image from Image Generation',
        important_details: {
          storageProvider: 'r2',
          generated: true,
          size,
          sizeBytes: generated.sizeBytes,
        },
      })
      .select('id')
      .single()

    if (attachmentError || !attachment?.id) {
      console.error('[Image Generation] Attachment row insert failed', {
        message: attachmentError?.message,
      })
      return NextResponse.json(
        { error: 'Image generated but could not be saved.' },
        { status: 500 }
      )
    }

    console.info('[Image Generation] Storage save completed', {
      size,
      sizeBytes: generated.sizeBytes,
    })

    return NextResponse.json({
      success: true,
      image: {
        id: imageId,
        prompt,
        size,
        imageUrl: fileUrl(attachment.id),
        downloadUrl: fileUrl(attachment.id, true),
        filename,
        mimeType: generated.mimeType,
        sizeBytes: generated.sizeBytes,
        format: 'png',
        createdAt: new Date().toISOString(),
      },
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error: any) {
    console.error('[Image Generation] Request failed', {
      message: error?.message,
      name: error?.name,
    })
    const safeError = typeof error?.message === 'string' && (
      error.message === 'Enter a more detailed image prompt.' ||
      error.message === 'Image Generation is busy. Please try again in a moment.' ||
      error.message === 'Image generated but could not be saved.'
    )
      ? error.message
      : 'Image Generation is temporarily unavailable.'

    return NextResponse.json(
      { error: safeError },
      { status: 500 }
    )
  }
}
