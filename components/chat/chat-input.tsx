'use client'

import { useState, useRef, KeyboardEvent } from 'react'
import { Send, Loader2, Image as ImageIcon, X, Paperclip, FileText, FileSpreadsheet, FileJson, File, Upload, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChatAttachment, ReasoningMode } from '@/types/models'
import { toast } from '@/components/ui/use-toast'
import { useR2Upload } from '@/hooks/use-r2-upload'
import { ReasoningSelector } from '@/components/chat/reasoning-selector'

interface ChatInputProps {
  onSend: (message: string, attachments?: ChatAttachment[]) => void
  disabled?: boolean
  isLoading?: boolean
  conversationId?: string | null
  reasoningMode?: ReasoningMode
  onReasoningModeChange?: (mode: ReasoningMode) => void
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
const DOCUMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md', '.csv', '.json', '.docx', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mp3', '.wav', '.zip', '.tar', '.gz', '.xlsx', '.pptx']
const MAX_FILES = 30

function getFileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`
}

function deduplicateFiles(newFiles: ChatAttachment[], incomingFiles: File[]): File[] {
  const existingKeys = new Set(newFiles.map(a => `${a.name}|${a.size}`))
  return Array.from(incomingFiles).filter(f => !existingKeys.has(`${f.name}|${f.size}`))
}

function getMimeFromExtension(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop()
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',
  }
  return map[ext || ''] || null
}

function getFileIcon(mimeType: string) {
  if (mimeType === 'application/pdf') return <FileText className="h-5 w-5 text-red-400" />
  if (mimeType === 'text/csv') return <FileSpreadsheet className="h-5 w-5 text-green-400" />
  if (mimeType === 'application/json') return <FileJson className="h-5 w-5 text-yellow-400" />
  if (mimeType === 'text/markdown') return <FileText className="h-5 w-5 text-blue-400" />
  if (mimeType === 'text/plain') return <FileText className="h-5 w-5 text-gray-300" />
  if (mimeType.includes('wordprocessingml')) return <FileText className="h-5 w-5 text-blue-500" />
  return <File className="h-5 w-5 text-gray-400" />
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ChatInput({ onSend, disabled, isLoading, conversationId, reasoningMode, onReasoningModeChange }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { uploadToR2, maxUploadMB } = useR2Upload()

  const hasActiveUpload = attachments.some(a =>
    a.uploadStatus === 'pending' ||
    a.uploadStatus === 'compressing' ||
    a.uploadStatus === 'uploading' ||
    a.uploadStatus === 'processing'
  )

  const handleSubmit = () => {
    if (hasActiveUpload) return
    if ((message.trim() || attachments.length > 0) && !disabled && !isLoading) {
      const content = message.trim() || (attachments.length > 0 ? 'Please analyze the attached file.' : '')
      const readyAttachments = attachments.filter(a => a.uploadStatus !== 'failed')
      onSend(content, readyAttachments.length > 0 ? readyAttachments : undefined)
      setMessage('')
      setAttachments([])
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`
  }

  const processFile = async (file: File): Promise<void> => {
    if (attachments.length >= MAX_FILES) {
      toast({
        title: 'Too many files',
        description: `Maximum ${MAX_FILES} files per message`,
        variant: 'destructive',
      })
      return
    }

    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '')
    const mime = getMimeFromExtension(file.name) || file.type

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      toast({
        title: 'Unsupported file type',
        description: `Only these file types are supported: ${ALLOWED_EXTENSIONS.join(', ')}`,
        variant: 'destructive',
      })
      return
    }

    const maxBytes = maxUploadMB * 1024 * 1024
    if (file.size > maxBytes) {
      toast({
        title: 'File too large',
        description: `Maximum file size is ${maxUploadMB}MB.`,
        variant: 'destructive',
      })
      return
    }

    const isImage = IMAGE_TYPES.includes(mime)
    // Use unique file key instead of index to avoid race conditions with multiple files
    const fileKey = getFileKey(file)

    const placeholder: ChatAttachment = {
      type: isImage ? 'image' : 'document',
      name: file.name,
      mimeType: mime,
      size: file.size,
      clientUploadId: fileKey,
      uploadStatus: 'pending',
      uploadProgress: 0,
    }

    setAttachments((prev) => [...prev, placeholder])

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Chat Input] File processing started:', { name: file.name, key: fileKey })
    }

    const result = await uploadToR2(file, conversationId || null, (updated) => {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Chat Input] Upload progress:', { name: file.name, status: updated.uploadStatus, progress: updated.uploadProgress })
      }
      // Update attachment by matching file key to avoid index mismatch
      setAttachments((prev) => prev.map((a) => 
        a.clientUploadId === fileKey ? { ...a, ...updated, clientUploadId: fileKey } : a
      ))
    })

    if (result.error) {
      toast({
        title: 'Upload failed',
        description: result.error,
        variant: 'destructive',
      })
      if (process.env.NODE_ENV !== 'production') {
        console.error('[Chat Input] Upload failed:', { name: file.name, error: result.error })
      }
    } else {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Chat Input] File upload complete:', { name: file.name, status: result.attachment.uploadStatus })
      }
    }

    const finalAttachment = { ...result.attachment, clientUploadId: fileKey }
    setAttachments((prev) => prev.map((a) => 
      a.clientUploadId === fileKey ? finalAttachment : a
    ))
  }

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Chat Input] Files selected:', {
        count: files.length,
        names: Array.from(files).map(f => f.name),
        currentAttachments: attachments.length,
      })
    }

    const uniqueFiles = deduplicateFiles(attachments, Array.from(files))

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Chat Input] After dedup:', {
        uniqueCount: uniqueFiles.length,
        names: uniqueFiles.map(f => f.name),
      })
    }

    const remaining = MAX_FILES - attachments.length
    const filesToProcess = uniqueFiles.slice(0, remaining)

    if (filesToProcess.length < uniqueFiles.length) {
      toast({
        title: 'Attachment limit reached',
        description: `Maximum ${MAX_FILES} files per message`,
        variant: 'destructive',
      })
    }

    await Promise.all(filesToProcess.map(file => processFile(file)))

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Chat Input] File selection complete')
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          await processFile(file)
        }
      }
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      await handleFileSelect(files)
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div
      className="sticky bottom-0 border-t border-white/[0.06] bg-[#08070d]/90 backdrop-blur-sm md:backdrop-blur-xl p-3 md:p-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-violet-500/5 backdrop-blur-md z-[60] flex items-center justify-center border-2 border-dashed border-violet-500/30 rounded-2xl m-3 md:m-4 pointer-events-none">
          <div className="text-center">
            <Paperclip className="h-12 w-12 text-violet-400 mx-auto mb-2" />
            <p className="text-white font-medium">Drop files here</p>
            <p className="text-gray-400 text-sm mt-1">Images, PDFs, TXT, CSV, JSON, MD</p>
          </div>
        </div>
      )}
      <div className="max-w-4xl mx-auto">
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl md:rounded-3xl p-2.5 md:p-3 transition-colors hover:border-white/[0.12]">
          {attachments.length > 0 && (
            <>
            <div className="text-xs text-gray-400 mb-2 px-1">
              {attachments.length} / {MAX_FILES} attachments
            </div>
            <div className="flex gap-2 mb-2 md:mb-3 pb-2 md:pb-3 border-b border-white/10 overflow-x-auto">
              {attachments.map((attachment, index) => (
                <div key={index} className="relative group shrink-0">
                  {attachment.type === 'image' && attachment.dataUrl ? (
                    <div className="h-20 w-20 md:h-24 md:w-24 rounded-xl border-2 border-white/20 bg-black/20 overflow-hidden relative">
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="h-full w-full object-cover"
                      />
                      {(attachment.uploadStatus === 'uploading' || attachment.uploadStatus === 'processing') && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <span className="text-xs font-bold text-white">
                            {attachment.uploadStatus === 'processing' ? 'Processing' : `${attachment.uploadProgress || 0}%`}
                          </span>
                        </div>
                      )}
                      {attachment.uploadStatus === 'compressing' && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-20 w-48 md:h-24 md:w-56 rounded-xl border-2 border-white/15 bg-white/5 backdrop-blur-sm p-2.5 md:p-3 flex flex-col justify-between">
                      <div className="flex items-start gap-2">
                        {attachment.uploadStatus === 'uploading' || attachment.uploadStatus === 'processing' || attachment.uploadStatus === 'pending' ? (
                          <Upload className="h-5 w-5 text-violet-400 animate-pulse shrink-0" />
                        ) : attachment.uploadStatus === 'failed' ? (
                          <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
                        ) : attachment.uploadStatus === 'uploaded' ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                        ) : (
                          getFileIcon(attachment.mimeType)
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{attachment.name}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {attachment.uploadStatus === 'pending' ? 'Preparing...' :
                             attachment.uploadStatus === 'compressing' ? 'Compressing...' :
                             attachment.uploadStatus === 'uploading' ? `Uploading ${attachment.uploadProgress || 0}%` :
                             attachment.uploadStatus === 'processing' ? 'Processing in cloud...' :
                             attachment.uploadStatus === 'uploaded' ? 'Uploaded' :
                             attachment.uploadStatus === 'failed' ? `Failed${attachment.uploadError ? `: ${attachment.uploadError}` : ''}` :
                             attachment.size ? formatFileSize(attachment.size) : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-300 uppercase tracking-wider">
                          {attachment.name.split('.').pop()}
                        </span>
                        {(attachment.uploadStatus === 'uploading' || attachment.uploadStatus === 'processing') && (
                          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden ml-2">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all duration-300',
                                attachment.uploadStatus === 'processing' ? 'bg-amber-400' : 'bg-violet-500'
                              )}
                              style={{ width: `${attachment.uploadProgress || 0}%` }}
                            />
                          </div>
                        )}
                        {attachment.storageProvider === 'r2' && attachment.uploadStatus === 'uploaded' && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 ml-auto">
                            Cloud
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => removeAttachment(index)}
                    className="absolute -top-2 -right-2 h-6 w-6 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-lg transition-all"
                    title="Remove file"
                  >
                    <X className="h-3.5 w-3.5 text-white" />
                  </button>
                </div>
              ))}
            </div>            </>          )}
          <div className="flex items-end gap-2 md:gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.csv,.json,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mp3,.wav,.zip,.tar,.gz"
              multiple
              onChange={(e) => {
                handleFileSelect(e.target.files)
              }}
              className="hidden"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isLoading}
              className="h-10 w-10 md:h-11 md:w-11 rounded-xl shrink-0 hover:bg-white/10 text-gray-400 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Attach files"
            >
              <Paperclip className="h-4 w-4 md:h-5 md:w-5" />
            </Button>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Ask anything..."
              disabled={disabled || isLoading}
              className={cn(
                'flex-1 bg-transparent border-none outline-none resize-none text-white placeholder:text-gray-400 text-sm md:text-base',
                'min-h-[40px] md:min-h-[44px] max-h-[160px] md:max-h-[200px] py-2.5 md:py-3 px-1 md:px-2',
                'scrollbar-thin',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              rows={1}
              autoFocus
            />
            <Button
              onClick={handleSubmit}
              disabled={(!message.trim() && attachments.length === 0) || disabled || isLoading || hasActiveUpload}
              size="icon"
              className="bg-violet-600 hover:bg-violet-500 h-9 w-9 md:h-10 md:w-10 rounded-xl shrink-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin" />
              ) : hasActiveUpload ? (
                <Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin text-violet-300" />
              ) : (
                <Send className="h-4 w-4 md:h-5 md:w-5" />
              )}
            </Button>
          </div>
          {reasoningMode && onReasoningModeChange && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.05]">
              <ReasoningSelector
                selectedMode={reasoningMode}
                onSelectMode={onReasoningModeChange}
                disabled={disabled || isLoading}
              />
            </div>
          )}
        </div>
        <p className="text-xs text-gray-600 text-center mt-2 md:mt-2.5 hidden sm:block">
          Press <kbd className="px-1.5 py-0.5 bg-white/[0.05] rounded text-gray-500">Enter</kbd> to send, <kbd className="px-1.5 py-0.5 bg-white/[0.05] rounded text-gray-500">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  )
}
