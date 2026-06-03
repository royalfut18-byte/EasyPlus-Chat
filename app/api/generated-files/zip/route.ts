import { randomUUID } from 'crypto'
import JSZip from 'jszip'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { validateGeneratedZipManifest } from '@/lib/generated-zip'
import { createProjectMemory } from '@/lib/projects.server'
import { isR2Configured, uploadObjectToR2 } from '@/lib/storage/r2'

export const runtime = 'nodejs'
export const maxDuration = 60

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

    const body = await request.json()
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null
    const projectId = typeof body.projectId === 'string' ? body.projectId : null
    const requestId = typeof body.requestId === 'string' ? body.requestId : null
    const manifest = validateGeneratedZipManifest({
      type: 'generated_zip',
      filename: body.filename,
      files: body.files,
    })

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
      return NextResponse.json({ error: 'A Project ZIP must belong to a conversation.' }, { status: 400 })
    }

    const zip = new JSZip()
    for (const file of manifest.files) {
      zip.file(file.path, file.content)
    }

    const archive = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    console.info('[Generated ZIP] Archive created', {
      userId: user.id,
      conversationId,
      projectId,
      fileCount: manifest.files.length,
      sizeBytes: archive.byteLength,
    })

    const storageKey = `uploads/${user.id}/generated/${randomUUID()}/${manifest.filename}`
    const { bucket } = await uploadObjectToR2({
      key: storageKey,
      body: archive,
      mimeType: 'application/zip',
    })

    const createdAt = new Date().toISOString()
    const attachment = {
      type: 'document' as const,
      name: manifest.filename,
      mimeType: 'application/zip',
      size: archive.byteLength,
      storageProvider: 'r2' as const,
      storageKey,
      storagePath: storageKey,
      bucket,
      uploadStatus: 'uploaded' as const,
      generated: true,
      generatedFiles: manifest.files.map(file => file.path),
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
          file_name: manifest.filename,
          file_type: 'generated_zip',
          mime_type: 'application/zip',
          storage_path: storageKey,
          purpose_note: `Generated downloadable ZIP package with ${manifest.files.length} files`,
          important_details: {
            storageProvider: 'r2',
            storageKey,
            storagePath: storageKey,
            bucket,
            generated: true,
            generatedFiles: attachment.generatedFiles,
            sizeBytes: archive.byteLength,
          },
        })
        .select('id')
        .single()

      if (error) throw error
      attachmentId = inserted?.id || null

      console.info('[Generated ZIP] Attachment saved', {
        userId: user.id,
        conversationId,
        attachmentId,
        fileCount: manifest.files.length,
      })

      if (assistantMessageId) {
        const { data: assistantMessage } = await db
          .from('messages')
          .select('attachments')
          .eq('id', assistantMessageId)
          .limit(1)
          .single()
        const existingAttachments = Array.isArray(assistantMessage?.attachments) ? assistantMessage.attachments : []
        await db
          .from('messages')
          .update({ attachments: [...existingAttachments, { ...attachment, attachmentId }] })
          .eq('id', assistantMessageId)
      }
    }

    if (projectId) {
      createProjectMemory(projectId, user.id, {
        title: `Generated package: ${manifest.filename}`,
        content: `Generated a downloadable ZIP package named ${manifest.filename} containing ${manifest.files.length} files.`,
        memory_type: 'task',
        importance: 2,
        source_type: 'conversation',
        source_id: conversationId,
      }).catch((error: any) => {
        console.warn('[Generated ZIP] Failed to save Project memory:', error.message)
      })
    }

    return NextResponse.json({
      success: true,
      fileId: attachmentId,
      filename: manifest.filename,
      downloadUrl: attachmentId
        ? `/api/attachments/file?attachmentId=${encodeURIComponent(attachmentId)}&download=1`
        : `/api/attachments/file?key=${encodeURIComponent(storageKey)}&name=${encodeURIComponent(manifest.filename)}&mimeType=application%2Fzip&download=1`,
      sizeBytes: archive.byteLength,
      attachment: { ...attachment, attachmentId },
    })
  } catch (error: any) {
    console.error('[Generated ZIP] Failed:', {
      message: error.message,
      code: error.code,
      phase: 'create_zip_or_save_attachment',
    })
    const isValidationError = /zip|package|unsafe|duplicate|required|entry/i.test(error.message || '')
    return NextResponse.json(
      { error: isValidationError ? error.message : 'Could not create ZIP. Please try again.' },
      { status: isValidationError ? 400 : 500 }
    )
  }
}
