'use client'

import { useState, useCallback } from 'react'
import { ChatAttachment } from '@/types/models'

const MAX_UPLOAD_MB = parseInt(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || '512', 10)
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

function parseR2ErrorFromResponse(xml: string): { code?: string; message?: string } | undefined {
  const codeMatch = xml.match(/<Code>(.*?)<\/Code>/)
  const msgMatch = xml.match(/<Message>(.*?)<\/Message>/)
  if (!codeMatch) return undefined
  return { code: codeMatch[1], message: msgMatch?.[1] }
}

const SMALL_FILE_THRESHOLD = 4.5 * 1024 * 1024

interface UploadResult {
  attachment: ChatAttachment
  error?: string
}

async function compressImage(file: File, maxSizeMB = 4): Promise<File> {
  if (file.size <= maxSizeMB * 1024 * 1024) return file

  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)

      let { width, height } = img
      const maxDim = 2048
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(new File([blob], file.name, { type: 'image/jpeg' }))
          } else {
            resolve(file)
          }
        },
        'image/jpeg',
        0.85
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export function useR2Upload() {
  const [uploading, setUploading] = useState(false)

  const uploadToR2 = useCallback(async (
    file: File,
    conversationId: string | null,
    onProgress?: (attachment: ChatAttachment) => void
  ): Promise<UploadResult> => {
    const isImage = file.type.startsWith('image/')
    const attachmentBase: ChatAttachment = {
      type: isImage ? 'image' : 'document',
      name: file.name,
      mimeType: file.type,
      size: file.size,
      uploadStatus: 'uploading',
      uploadProgress: 0,
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return {
        attachment: { ...attachmentBase, uploadStatus: 'failed' },
        error: `File too large. Maximum size is ${MAX_UPLOAD_MB}MB.`,
      }
    }

    let uploadFile = file

    if (isImage && file.size > SMALL_FILE_THRESHOLD) {
      attachmentBase.uploadStatus = 'compressing'
      onProgress?.({ ...attachmentBase })
      uploadFile = await compressImage(file)
      attachmentBase.size = uploadFile.size
      attachmentBase.mimeType = uploadFile.type
    }

    if (uploadFile.size <= SMALL_FILE_THRESHOLD) {
      try {
        const dataUrl = await readAsDataUrl(uploadFile)
        return {
          attachment: {
            ...attachmentBase,
            dataUrl,
            uploadStatus: 'uploaded',
            uploadProgress: 100,
            storageProvider: 'supabase',
          },
        }
      } catch {
        // Fall through to R2 upload
      }
    }

    attachmentBase.uploadStatus = 'uploading'
    attachmentBase.uploadProgress = 0
    onProgress?.({ ...attachmentBase })

    try {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[R2 Upload] Requesting presign:', { fileName: uploadFile.name, mimeType: uploadFile.type, sizeBytes: uploadFile.size })
      }

      const presignRes = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: uploadFile.name,
          mimeType: uploadFile.type,
          sizeBytes: uploadFile.size,
          conversationId: conversationId || undefined,
        }),
      })

      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({ error: 'Presign failed' }))
        if (process.env.NODE_ENV !== 'production') {
          console.error('[R2 Upload] Presign failed:', presignRes.status, err)
        }
        return {
          attachment: { ...attachmentBase, uploadStatus: 'failed' },
          error: err.error || `Presign failed (${presignRes.status})`,
        }
      }

      const { uploadUrl, key, bucket } = await presignRes.json()

      if (process.env.NODE_ENV !== 'production') {
        console.log('[R2 Upload] Presign success:', { key, bucket, hasUploadUrl: !!uploadUrl })
      }

      const uploadResult = await uploadWithProgress(uploadUrl, uploadFile, (progress) => {
        attachmentBase.uploadProgress = progress
        attachmentBase.uploadStatus = 'uploading'
        onProgress?.({ ...attachmentBase })
      })

      if (!uploadResult.ok) {
        let detail: string
        if (uploadResult.status && uploadResult.status > 0) {
          const r2Err = uploadResult.responseText ? parseR2ErrorFromResponse(uploadResult.responseText) : undefined
          if (r2Err?.code) {
            detail = `R2 error: ${r2Err.code} — ${r2Err.message || 'unknown'}`
          } else {
            detail = `R2 upload failed with status ${uploadResult.status}.`
          }
          if (uploadResult.status === 403) detail += ' Check token permissions, bucket name, or signed headers.'
        } else {
          detail = 'Browser blocked upload or network failed. Open DevTools Network and check the OPTIONS/PUT request.'
        }
        if (process.env.NODE_ENV !== 'production') {
          console.error('[R2 Upload] PUT failed:', { status: uploadResult.status, statusText: uploadResult.statusText, errorType: uploadResult.errorType, responseText: uploadResult.responseText })
        }
        return {
          attachment: { ...attachmentBase, uploadStatus: 'failed' },
          error: detail,
        }
      }

      let previewDataUrl: string | undefined
      if (isImage && uploadFile.size <= 2 * 1024 * 1024) {
        try {
          previewDataUrl = await readAsDataUrl(uploadFile)
        } catch { /* no preview */ }
      }

      return {
        attachment: {
          ...attachmentBase,
          storageProvider: 'r2',
          storageKey: key,
          bucket,
          storagePath: key,
          dataUrl: previewDataUrl,
          uploadStatus: 'uploaded',
          uploadProgress: 100,
        },
      }
    } catch (err: any) {
      return {
        attachment: { ...attachmentBase, uploadStatus: 'failed' },
        error: err.message || 'Upload failed',
      }
    }
  }, [])

  return { uploadToR2, uploading, setUploading, maxUploadMB: MAX_UPLOAD_MB }
}

interface UploadWithProgressResult {
  ok: boolean
  status?: number
  statusText?: string
  errorType?: 'network' | 'abort'
  responseText?: string
}

function parseR2Error(xml: string): { code?: string; message?: string } {
  const codeMatch = xml.match(/<Code>(.*?)<\/Code>/)
  const msgMatch = xml.match(/<Message>(.*?)<\/Message>/)
  return { code: codeMatch?.[1], message: msgMatch?.[1] }
}

function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<UploadWithProgressResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100)
        onProgress(percent)
      }
    })

    xhr.addEventListener('load', () => {
      const ok = xhr.status >= 200 && xhr.status < 300
      let responseText = ok ? undefined : xhr.responseText?.substring(0, 1000)
      if (process.env.NODE_ENV !== 'production') {
        const r2Error = responseText ? parseR2Error(responseText) : undefined
        console.log('[R2 Upload] PUT response:', { status: xhr.status, statusText: xhr.statusText, ok, r2Error })
      }
      resolve({
        ok,
        status: xhr.status,
        statusText: xhr.statusText,
        responseText,
      })
    })

    xhr.addEventListener('error', () => {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[R2 Upload] PUT network error, xhr.status:', xhr.status)
      }
      resolve({ ok: false, status: 0, errorType: 'network' })
    })

    xhr.addEventListener('abort', () => {
      resolve({ ok: false, errorType: 'abort' })
    })

    if (process.env.NODE_ENV !== 'production') {
      try {
        const urlOrigin = new URL(url).origin
        console.log('[R2 Upload] PUT started:', { origin: urlOrigin, fileName: file.name, size: file.size, type: file.type })
      } catch { /* ignore URL parse errors */ }
    }

    // Send as Blob with empty type to prevent browser from adding Content-Type header.
    // The presigned URL only signs "host" header — any extra header causes R2 400.
    const uploadBlob = new Blob([file], { type: '' })
    xhr.open('PUT', url)
    xhr.send(uploadBlob)
  })
}
