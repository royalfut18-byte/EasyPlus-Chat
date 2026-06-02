import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { editAzureImage, generateAzureImage, isValidAzureImageSize, sanitizeImagePrompt } from '@/lib/ai/azure-image.server'
import { downloadObjectFromR2, getR2ConfigStatus, uploadObjectToR2 } from '@/lib/storage/r2'

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

function imageConversationTitle(prompt: string): string {
  const cleanPrompt = prompt.replace(/\s+/g, ' ').trim()
  if (!cleanPrompt) return 'Image Generation'

  const title = cleanPrompt.length > 56 ? `${cleanPrompt.slice(0, 56).trim()}...` : cleanPrompt
  return `Image: ${title}`
}

function looksLikeContextualImagePrompt(prompt: string): boolean {
  return /\b(add|change|edit|make it|make the|remove|replace|keep|same|darker|lighter|more realistic|background|next to it|instead|text saying)\b/i.test(prompt)
}

function buildEditPrompt(prompt: string, previousPrompt?: string | null): string {
  const previousContext = previousPrompt
    ? ` The previous image was created from this prompt: "${previousPrompt}".`
    : ''
  return `Edit the provided image. Keep the same composition, style, lighting, and subjects unless the requested change requires otherwise.${previousContext} Apply only this requested change: ${prompt}`
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const conversationId = request.nextUrl.searchParams.get('conversationId')
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation is required.' }, { status: 400 })
    }

    const { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .limit(1)
      .single()

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }

    const { data: attachments, error } = await supabase
      .from('attachments')
      .select('id, file_name, mime_type, important_details, created_at')
      .eq('user_id', user.id)
      .eq('conversation_id', conversationId)
      .eq('file_type', 'generated_image')
      .order('created_at', { ascending: true })

    if (error) throw error

    return NextResponse.json({
      images: (attachments || []).map((attachment: any) => ({
        id: attachment.id,
        attachmentId: attachment.id,
        conversationId,
        prompt: attachment.important_details?.prompt || 'Generated image',
        size: attachment.important_details?.size || '1024x1024',
        imageUrl: fileUrl(attachment.id),
        downloadUrl: fileUrl(attachment.id, true),
        filename: attachment.file_name,
        mimeType: attachment.mime_type || 'image/png',
        sizeBytes: attachment.important_details?.sizeBytes || 0,
        format: 'png',
        mode: attachment.important_details?.mode || 'text_to_image',
        referenceAttachmentId: attachment.important_details?.referenceAttachmentId || null,
        createdAt: attachment.created_at,
      })),
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error: any) {
    console.error('[Image Generation] History load failed', {
      message: error?.message,
      code: error?.code,
    })
    return NextResponse.json({ error: 'Could not load generated images.' }, { status: 500 })
  }
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
    const referenceImageAttachmentId = typeof body?.referenceImageAttachmentId === 'string'
      ? body.referenceImageAttachmentId
      : null
    const usePreviousImage = body?.usePreviousImage === true
    const forceNewImage = body?.forceNewImage === true

    if (!prompt || prompt.length < 3) {
      return NextResponse.json({ error: 'Enter a more detailed image prompt.' }, { status: 400 })
    }

    if (!isValidAzureImageSize(size)) {
      return NextResponse.json({ error: 'Unsupported image size.' }, { status: 400 })
    }

    let attachmentConversationId: string | null = conversationId
    let attachmentProjectId: string | null = projectId

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

      attachmentProjectId = conversation.project_id || null
    } else {
      const insertPayload: any = {
        user_id: user.id,
        title: imageConversationTitle(prompt),
        model_used: 'image-generation',
      }

      if (projectId) {
        const { data: projectRow, error: projectError } = await db
          .from('projects')
          .select('id, user_id')
          .eq('id', projectId)
          .limit(1)
          .single()

        if (projectError || !projectRow || projectRow.user_id !== user.id) {
          return NextResponse.json({ error: 'Invalid project' }, { status: 403 })
        }

        insertPayload.project_id = projectId
      }

      const { data: newConversation, error: conversationError } = await db
        .from('conversations')
        .insert(insertPayload)
        .select('id, project_id')
        .single()

      if (conversationError || !newConversation?.id) {
        console.error('[Image Generation] Conversation row insert failed before image generation', {
          message: conversationError?.message,
          code: conversationError?.code,
          dbInsertAttempted: true,
          dbInsertSuccess: false,
        })
        return NextResponse.json(
          { error: 'Image Generation is temporarily unavailable.' },
          { status: 500 }
        )
      }

      attachmentConversationId = newConversation.id
      attachmentProjectId = newConversation.project_id || null

      console.info('[Image Generation] Conversation row created for generated image', {
        dbInsertSuccess: true,
        hasProject: !!attachmentProjectId,
      })
    }

    if (!attachmentConversationId) {
      console.error('[Image Generation] Missing attachment conversation after validation', {
        dbInsertAttempted: false,
      })
      return NextResponse.json(
        { error: 'Image Generation is temporarily unavailable.' },
        { status: 500 }
      )
    }

    let referenceAttachment: any = null
    const shouldUseReference = !forceNewImage && (
      !!referenceImageAttachmentId ||
      usePreviousImage ||
      looksLikeContextualImagePrompt(prompt)
    )

    if (shouldUseReference) {
      let referenceQuery = db
        .from('attachments')
        .select('id, conversation_id, user_id, file_type, mime_type, storage_path, important_details')
        .eq('user_id', user.id)
        .eq('conversation_id', attachmentConversationId)
        .eq('file_type', 'generated_image')

      referenceQuery = referenceImageAttachmentId
        ? referenceQuery.eq('id', referenceImageAttachmentId).limit(1).single()
        : referenceQuery.order('created_at', { ascending: false }).limit(1).maybeSingle()

      const { data: referenceRow, error: referenceError } = await referenceQuery
      if (referenceError) {
        console.error('[Image Generation] Reference attachment lookup failed', {
          message: referenceError.message,
          code: referenceError.code,
          referenceSelected: true,
          referenceAttachmentIdExists: !!referenceImageAttachmentId,
        })
        return NextResponse.json(
          { error: 'Could not load the previous image reference.' },
          { status: 500 }
        )
      }

      referenceAttachment = referenceRow
    }

    let generated
    let generationMode: 'text_to_image' | 'image_edit' = 'text_to_image'
    if (referenceAttachment) {
      const referenceMimeType = typeof referenceAttachment.mime_type === 'string'
        ? referenceAttachment.mime_type
        : ''
      const referenceStorageKey = referenceAttachment.storage_path ||
        referenceAttachment.important_details?.storageKey ||
        referenceAttachment.important_details?.storagePath

      if (!referenceMimeType.startsWith('image/') || !referenceStorageKey) {
        return NextResponse.json(
          { error: 'Could not load the previous image reference.' },
          { status: 500 }
        )
      }

      let referenceImageBuffer: Buffer
      try {
        referenceImageBuffer = await downloadObjectFromR2(referenceStorageKey)
        console.info('[Image Generation] Reference image loaded from storage', {
          mode: 'image_edit',
          referenceSelected: true,
          referenceAttachmentIdExists: true,
          r2ReferenceFetchSuccess: true,
          referenceMimeType,
          referenceSizeBytes: referenceImageBuffer.byteLength,
        })
      } catch (error: any) {
        console.error('[Image Generation] Reference image storage fetch failed', {
          message: error?.message,
          mode: 'image_edit',
          referenceSelected: true,
          referenceAttachmentIdExists: true,
          r2ReferenceFetchSuccess: false,
        })
        return NextResponse.json(
          { error: 'Could not load the previous image reference.' },
          { status: 500 }
        )
      }

      generationMode = 'image_edit'
      generated = await editAzureImage(
        buildEditPrompt(prompt, referenceAttachment.important_details?.prompt),
        size,
        referenceImageBuffer,
        referenceMimeType
      )
    } else {
      console.info('[Image Generation] Starting new image generation', {
        mode: 'text_to_image',
        referenceSelected: shouldUseReference,
        referenceAttachmentIdExists: !!referenceImageAttachmentId,
      })
      generated = await generateAzureImage(prompt, size)
    }

    const imageBuffer = Buffer.from(generated.base64, 'base64')
    const imageId = randomUUID()
    const filename = safeFileName(prompt)
    const storageKey = `uploads/${user.id}/generated-images/${imageId}/${filename}`

    console.info('[Image Generation] Saving generated image to storage', {
      mode: generationMode,
      referenceSelected: !!referenceAttachment,
      size,
      sizeBytes: generated.sizeBytes,
      decodedBytes: imageBuffer.byteLength,
      outputDecodeSuccess: imageBuffer.byteLength > 0,
      mimeType: generated.mimeType,
      storageConfigured: storageStatus.configured,
      uploadAttempted: true,
    })

    let uploadResult: { key: string; bucket: string }
    try {
      uploadResult = await uploadObjectToR2({
        key: storageKey,
        body: imageBuffer,
        mimeType: generated.mimeType,
      })
      console.info('[Image Generation] R2 upload completed', {
        uploadSuccess: true,
        bucket: uploadResult.bucket,
        sizeBytes: imageBuffer.byteLength,
        mimeType: generated.mimeType,
      })
    } catch (error: any) {
      console.error('[Image Generation] Storage upload failed after Azure generation', {
        message: error?.message,
        errorCode: error?.Code || error?.code || error?.$metadata?.httpStatusCode || null,
        storageConfigured: storageStatus.configured,
        uploadAttempted: true,
        uploadSuccess: false,
        sizeBytes: imageBuffer.byteLength,
        mimeType: generated.mimeType,
      })
      return NextResponse.json(
        { error: 'Image generated but could not be saved.' },
        { status: 503 }
      )
    }

    console.info('[Image Generation] Attachment insert starting', {
      mode: generationMode,
      dbInsertAttempted: true,
      mimeType: generated.mimeType,
      sizeBytes: generated.sizeBytes,
    })

    const { data: attachment, error: attachmentError } = await db
      .from('attachments')
      .insert({
        user_id: user.id,
        conversation_id: attachmentConversationId,
        project_id: attachmentProjectId,
        file_name: filename,
        file_type: 'generated_image',
        mime_type: generated.mimeType,
        storage_path: storageKey,
        purpose_note: 'Generated image from Image Generation',
        important_details: {
          storageProvider: 'r2',
          storageKey,
          storagePath: storageKey,
          bucket: uploadResult.bucket,
          generated: true,
          kind: 'image_generation',
          prompt,
          size,
          sizeBytes: generated.sizeBytes,
          mode: generationMode,
          referenceAttachmentId: referenceAttachment?.id || null,
          parentAttachmentId: referenceAttachment?.id || null,
        },
      })
      .select('id')
      .single()

    if (attachmentError || !attachment?.id) {
      console.error('[Image Generation] Attachment row insert failed', {
        message: attachmentError?.message,
        code: attachmentError?.code,
        dbInsertAttempted: true,
        dbInsertSuccess: false,
        mimeType: generated.mimeType,
        sizeBytes: generated.sizeBytes,
      })
      return NextResponse.json(
        { error: 'Image generated but could not be saved.' },
        { status: 500 }
      )
    }

    console.info('[Image Generation] Storage save completed', {
      mode: generationMode,
      referenceSelected: !!referenceAttachment,
      size,
      sizeBytes: generated.sizeBytes,
      uploadSuccess: true,
      dbInsertSuccess: true,
      mimeType: generated.mimeType,
    })

    return NextResponse.json({
      success: true,
      image: {
        id: imageId,
        attachmentId: attachment.id,
        conversationId: attachmentConversationId,
        prompt,
        size,
        imageUrl: fileUrl(attachment.id),
        downloadUrl: fileUrl(attachment.id, true),
        filename,
        mimeType: generated.mimeType,
        sizeBytes: generated.sizeBytes,
        format: 'png',
        mode: generationMode,
        referenceAttachmentId: referenceAttachment?.id || null,
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
      error.message === 'Image generated but could not be saved.' ||
      error.message === 'Could not edit the previous image. Try generating a new image.' ||
      error.message === 'Image editing is not supported by the current image model yet.'
    )
      ? error.message
      : 'Image Generation is temporarily unavailable.'

    return NextResponse.json(
      { error: safeError },
      { status: 500 }
    )
  }
}
