import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { generateBinaryFileFromArtifact } from '@/lib/generated-files.server'
import { isR2Configured, uploadObjectToR2 } from '@/lib/storage/r2'

export const runtime = 'nodejs'
export const maxDuration = 90

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest) {
  try {
    if (!isR2Configured()) {
      return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 })
    }

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

    const body = await request.json().catch(() => null)
    const title = safeString(body?.title) || 'Generated file'
    const language = safeString(body?.language)
    const content = typeof body?.content === 'string'
      ? body.content
      : JSON.stringify(body?.content || {}, null, 2)
    const conversationId = safeString(body?.conversationId) || null
    const projectId = safeString(body?.projectId) || null
    const requestId = safeString(body?.requestId) || null

    let assistantMessageId: string | null = null
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

      if (requestId) {
        const { data: assistantMessage } = await db
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('request_id', requestId)
          .eq('role', 'assistant')
          .limit(1)
          .single()
        assistantMessageId = assistantMessage?.id || null
      }
    } else if (projectId) {
      return NextResponse.json({ error: 'A Project file must belong to a conversation.' }, { status: 400 })
    }

    console.info('[Generated File] Request received', {
      requestedOutputType: language,
      conversationId,
      projectId,
      requestId,
      title,
    })

    const generatedFile = await generateBinaryFileFromArtifact({
      kind: language,
      title,
      content,
    })

    console.info('[Generated File] Binary generated', {
      requestedOutputType: language,
      generatedExtension: generatedFile.extension,
      mimeType: generatedFile.mimeType,
      fileByteSize: generatedFile.byteSize,
      hasBinaryBuffer: generatedFile.buffer.byteLength > 0,
      validationResult: generatedFile.validation,
    })

    if (!generatedFile.validation.valid) {
      const message = generatedFile.kind === 'pptx' || generatedFile.kind === 'gslides'
        ? 'PowerPoint file could not be generated correctly. Please try again.'
        : generatedFile.kind === 'docx' || generatedFile.kind === 'gdoc'
          ? 'Word document could not be generated correctly. Please try again.'
          : 'PDF file could not be generated correctly. Please try again.'
      return NextResponse.json({ error: message }, { status: 500 })
    }

    const storageKey = `uploads/${user.id}/generated/${randomUUID()}/${generatedFile.filename}`
    const { bucket } = await uploadObjectToR2({
      key: storageKey,
      body: generatedFile.buffer,
      mimeType: generatedFile.mimeType,
    })

    console.info('[Generated File] Storage upload complete', {
      requestedOutputType: language,
      generatedExtension: generatedFile.extension,
      mimeType: generatedFile.mimeType,
      fileByteSize: generatedFile.byteSize,
      storageUploadSuccess: true,
    })

    const createdAt = new Date().toISOString()
    const attachment = {
      type: 'document' as const,
      name: generatedFile.filename,
      mimeType: generatedFile.mimeType,
      size: generatedFile.byteSize,
      storageProvider: 'r2' as const,
      storageKey,
      storagePath: storageKey,
      bucket,
      uploadStatus: 'uploaded' as const,
      generated: true,
      generatedFiles: [generatedFile.filename],
      createdAt,
    }

    let attachmentId: string | null = null
    if (conversationId) {
      const { data: inserted, error } = await db
        .from('attachments')
        .insert({
          user_id: user.id,
          conversation_id: conversationId,
          project_id: projectId,
          message_id: assistantMessageId,
          file_name: generatedFile.filename,
          file_type: `generated_${generatedFile.extension}`,
          mime_type: generatedFile.mimeType,
          storage_path: storageKey,
          purpose_note: `Generated downloadable ${generatedFile.label}`,
          important_details: {
            storageProvider: 'r2',
            storageKey,
            storagePath: storageKey,
            bucket,
            generated: true,
            generatedFiles: [generatedFile.filename],
            sizeBytes: generatedFile.byteSize,
            requestedOutputType: language,
            generatedExtension: generatedFile.extension,
            mimeType: generatedFile.mimeType,
            validationResult: generatedFile.validation,
          },
        })
        .select('id')
        .single()

      if (error) throw error
      attachmentId = inserted?.id || null

      if (assistantMessageId) {
        const { data: assistantMessage } = await db
          .from('messages')
          .select('attachments')
          .eq('id', assistantMessageId)
          .limit(1)
          .single()
        const existingAttachments = Array.isArray(assistantMessage?.attachments) ? assistantMessage.attachments : []
        const alreadyAttached = existingAttachments.some((entry: any) => entry?.attachmentId === attachmentId)
        if (!alreadyAttached) {
          await db
            .from('messages')
            .update({ attachments: [...existingAttachments, { ...attachment, attachmentId }] })
            .eq('id', assistantMessageId)
        }
      }
    }

    return NextResponse.json({
      success: true,
      filename: generatedFile.filename,
      mimeType: generatedFile.mimeType,
      sizeBytes: generatedFile.byteSize,
      validation: generatedFile.validation,
      previewText: generatedFile.previewText,
      downloadUrl: attachmentId
        ? `/api/attachments/file?attachmentId=${encodeURIComponent(attachmentId)}&download=1`
        : `/api/attachments/file?key=${encodeURIComponent(storageKey)}&name=${encodeURIComponent(generatedFile.filename)}&mimeType=${encodeURIComponent(generatedFile.mimeType)}&download=1`,
      attachment: { ...attachment, attachmentId },
    })
  } catch (error: any) {
    console.error('[Generated File] Failed', {
      message: error?.message,
      requestedOutputType: 'unknown',
      phase: 'generate_or_store_binary_file',
    })
    const message = String(error?.message || '')
    const safeMessage =
      message.includes('PowerPoint file could not be generated correctly')
        ? message
        : message.includes('Word document could not be generated correctly')
          ? message
          : message.includes('PDF file could not be generated correctly')
            ? message
            : 'The file could not be generated correctly. Please try again.'
    return NextResponse.json({ error: safeMessage }, { status: 500 })
  }
}

