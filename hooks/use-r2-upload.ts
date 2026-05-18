'use client'

import { useState, useCallback } from 'react'
import { ChatAttachment } from '@/types/models'
import { INLINE_UPLOAD_MAX_BYTES } from '@/lib/upload-limits'

const MAX_UPLOAD_MB = parseInt(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || '512', 10)
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
const MODEL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])

function parseR2ErrorFromResponse(xml: string): { code?: string; message?: string } | undefined {
  const codeMatch = xml.match(/<Code>(.*?)<\/Code>/)
  const msgMatch = xml.match(/<Message>(.*?)<\/Message>/)
  if (!codeMatch) return undefined
  return { code: codeMatch[1], message: msgMatch?.[1] }
}

const INLINE_DATA_URL_THRESHOLD = INLINE_UPLOAD_MAX_BYTES
const SERVER_UPLOAD_THRESHOLD = 20 * 1024 * 1024 // 20MB: use server upload if file is smaller

interface UploadResult {
  attachment: ChatAttachment
  error?: string
}

function inferMimeType(file: File): string {
  if (file.type) {
    return file.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : file.type
  }

  const ext = file.name.toLowerCase().split('.').pop()
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }

  return map[ext || ''] || 'application/octet-stream'
}

function withInferredMimeType(file: File): File {
  const mimeType = inferMimeType(file)
  if (file.type === mimeType) return file
  return new File([file], file.name, { type: mimeType, lastModified: file.lastModified })
}

async function compressImage(file: File, force = false): Promise<File> {
  if (!force && file.size <= INLINE_DATA_URL_THRESHOLD) return file

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
            const outputName = file.name.replace(/\.[^.]+$/, '') || 'image'
            resolve(new File([blob], `${outputName}.jpg`, { type: 'image/jpeg' }))
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

async function uploadViaServer(
  file: File,
  conversationId: string | null,
  onProgress: (percent: number) => void,
  onProcessing: () => void
): Promise<{ ok: boolean; data?: any; error?: string }> {
  return new Promise((resolve) => {
    const formData = new FormData()
    formData.append('file', file)
    if (conversationId) {
      formData.append('conversationId', conversationId)
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Server Upload] Starting:', { fileName: file.name, size: file.size })
    }

    const xhr = new XMLHttpRequest()
    let processingStarted = false

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      const percent = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)))
      onProgress(percent)
      if (percent >= 100 && !processingStarted) {
        processingStarted = true
        onProcessing()
      }
    }

    xhr.onload = () => {
      let data: any = null
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        data = null
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        const error = data?.error || `Server upload failed (${xhr.status})`
        if (process.env.NODE_ENV !== 'production') {
          console.error('[Server Upload] Failed:', xhr.status, data)
        }
        resolve({ ok: false, error })
        return
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[Server Upload] Success:', data)
      }
      resolve({ ok: true, data })
    }

    xhr.onerror = () => {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[Server Upload] Network error')
      }
      resolve({ ok: false, error: 'Server upload network error' })
    }

    xhr.onabort = () => {
      resolve({ ok: false, error: 'Server upload was cancelled' })
    }

    xhr.open('POST', '/api/upload/server-upload')
    xhr.send(formData)
  })
}

export function useR2Upload() {
  const [uploading, setUploading] = useState(false)

  const uploadToR2 = useCallback(async (
    file: File,
    conversationId: string | null,
    onProgress?: (attachment: ChatAttachment) => void
  ): Promise<UploadResult> => {
    let uploadFile = withInferredMimeType(file)
    const isImage = uploadFile.type.startsWith('image/')
    const attachmentBase: ChatAttachment = {
      type: isImage ? 'image' : 'document',
      name: uploadFile.name,
      mimeType: uploadFile.type,
      size: uploadFile.size,
      uploadStatus: 'pending',
      uploadProgress: 0,
    }

    if (uploadFile.size > MAX_UPLOAD_BYTES) {
      return {
        attachment: { ...attachmentBase, uploadStatus: 'failed', uploadError: `File too large. Maximum size is ${MAX_UPLOAD_MB}MB.` },
        error: `File too large. Maximum size is ${MAX_UPLOAD_MB}MB.`,
      }
    }

    const imageNeedsConversion = isImage && !MODEL_IMAGE_TYPES.has(uploadFile.type.toLowerCase())

    if (isImage && (file.size > INLINE_DATA_URL_THRESHOLD || imageNeedsConversion)) {
      attachmentBase.uploadStatus = 'compressing'
      onProgress?.({ ...attachmentBase })
      uploadFile = await compressImage(file, imageNeedsConversion)
      attachmentBase.size = uploadFile.size
      attachmentBase.mimeType = uploadFile.type
      attachmentBase.name = uploadFile.name
    }

    if (isImage && !MODEL_IMAGE_TYPES.has(uploadFile.type.toLowerCase())) {
      return {
        attachment: {
          ...attachmentBase,
          uploadStatus: 'failed',
          uploadError: 'Unsupported image type. Please upload PNG, JPEG, or WebP.',
        },
        error: 'Unsupported image type. Please upload PNG, JPEG, or WebP.',
      }
    }

    if (uploadFile.size <= INLINE_DATA_URL_THRESHOLD) {
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

    // For files <= 20MB, try server-side upload first (more reliable than presigned)
    if (uploadFile.size <= SERVER_UPLOAD_THRESHOLD) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[R2 Upload] Attempting server-side upload:', { fileName: uploadFile.name, sizeBytes: uploadFile.size })
      }

      const serverResult = await uploadViaServer(uploadFile, conversationId, (progress) => {
        attachmentBase.uploadProgress = progress
        attachmentBase.uploadStatus = 'uploading'
        onProgress?.({ ...attachmentBase })
      }, () => {
        attachmentBase.uploadProgress = 100
        attachmentBase.uploadStatus = 'processing'
        onProgress?.({ ...attachmentBase })
      })

      if (serverResult.ok && serverResult.data) {
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
            storageKey: serverResult.data.key,
            bucket: serverResult.data.bucket,
            storagePath: serverResult.data.key,
            dataUrl: previewDataUrl,
            uploadStatus: 'uploaded',
            uploadProgress: 100,
          },
        }
      }
      // If server upload fails, log and fall through to presigned URL
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[R2 Upload] Server upload failed, falling back to presigned:', serverResult.error)
      }
      attachmentBase.uploadStatus = 'uploading'
      attachmentBase.uploadProgress = 0
      onProgress?.({ ...attachmentBase })
    }

    // Fall back to presigned URL (for files > 20MB or if server upload failed)
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
          attachment: { ...attachmentBase, uploadStatus: 'failed', uploadError: err.error || `Presign failed (${presignRes.status})` },
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
          attachment: { ...attachmentBase, uploadStatus: 'failed', uploadError: detail },
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
        attachment: { ...attachmentBase, uploadStatus: 'failed', uploadError: err.message || 'Upload failed' },
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

function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<UploadWithProgressResult> {
  // Blob with empty type so browser does NOT send Content-Type header.
  // The presigned URL only signs "host" — any extra header causes R2 400.
  const uploadBody = new Blob([file], { type: '' })

  if (process.env.NODE_ENV !== 'production') {
    try {
      const urlOrigin = new URL(url).origin
      console.log('[R2 Upload] PUT started:', {
        origin: urlOrigin,
        fileName: file.name,
        size: file.size,
        originalType: file.type,
        blobType: uploadBody.type,
        bodyIs: uploadBody instanceof Blob ? 'Blob' : 'other',
        method: 'fetch',
      })
    } catch { /* ignore */ }
  }

  // Use fetch() — unlike XHR, fetch does NOT send Content-Type for Blob with empty type.
  return fetch(url, {
    method: 'PUT',
    body: uploadBody,
  }).then(async (res) => {
    const ok = res.status >= 200 && res.status < 300
    let responseText: string | undefined
    if (!ok) {
      try { responseText = (await res.text()).substring(0, 1000) } catch { /* ignore */ }
    }
    if (process.env.NODE_ENV !== 'production') {
      const r2Error = responseText ? parseR2ErrorFromResponse(responseText) : undefined
      console.log('[R2 Upload] PUT response:', { status: res.status, statusText: res.statusText, ok, r2Error })
    }
    onProgress(100)
    return { ok, status: res.status, statusText: res.statusText, responseText }
  }).catch((err) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[R2 Upload] PUT fetch error:', err.message)
    }
    return { ok: false, status: 0, errorType: 'network' as const }
  })
}
