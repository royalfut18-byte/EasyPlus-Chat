'use client'

import { useState, useRef, KeyboardEvent, useEffect } from 'react'
import { Send, Loader2, Image as ImageIcon, X, Paperclip, FileText, FileSpreadsheet, FileJson, File } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChatAttachment } from '@/types/models'
import { toast } from '@/components/ui/use-toast'

interface ChatInputProps {
  onSend: (message: string, attachments?: ChatAttachment[]) => void
  disabled?: boolean
  isLoading?: boolean
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
const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md', '.csv', '.json', '.docx', '.png', '.jpg', '.jpeg', '.webp']
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_DOC_SIZE = 500 * 1024 * 1024
const MAX_FILES = 5

function getMimeFromExtension(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop()
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
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

export function ChatInput({ onSend, disabled, isLoading }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = () => {
    if ((message.trim() || attachments.length > 0) && !disabled && !isLoading) {
      const content = message.trim() || (attachments.length > 0 ? 'Please analyze the attached file.' : '')
      onSend(content, attachments.length > 0 ? attachments : undefined)
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

  const processFile = async (file: File): Promise<ChatAttachment | null> => {
    if (attachments.length >= MAX_FILES) {
      toast({
        title: 'Too many files',
        description: `Maximum ${MAX_FILES} files per message`,
        variant: 'destructive',
      })
      return null
    }

    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '')
    const mime = getMimeFromExtension(file.name) || file.type

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      toast({
        title: 'Unsupported file type',
        description: `Only these file types are supported: ${ALLOWED_EXTENSIONS.join(', ')}`,
        variant: 'destructive',
      })
      return null
    }

    if (mime.includes('wordprocessingml')) {
      toast({
        title: 'DOCX support coming soon',
        description: 'Please convert to PDF or TXT for now.',
        variant: 'destructive',
      })
      return null
    }

    const isImage = IMAGE_TYPES.includes(mime)
    const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_DOC_SIZE

    if (file.size > maxSize) {
      toast({
        title: 'File too large',
        description: isImage
          ? 'Images must be smaller than 5MB'
          : 'Documents must be smaller than 500MB',
        variant: 'destructive',
      })
      return null
    }

    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        resolve({
          type: isImage ? 'image' : 'document',
          name: file.name,
          mimeType: mime,
          size: file.size,
          dataUrl,
        })
      }
      reader.onerror = () => {
        toast({
          title: 'Error reading file',
          description: 'Failed to process file',
          variant: 'destructive',
        })
        resolve(null)
      }
      reader.readAsDataURL(file)
    })
  }

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    for (let i = 0; i < files.length; i++) {
      if (attachments.length >= MAX_FILES) break
      const attachment = await processFile(files[i])
      if (attachment) {
        setAttachments((prev) => {
          if (prev.length >= MAX_FILES) return prev
          return [...prev, attachment]
        })
      }
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
          const attachment = await processFile(file)
          if (attachment) {
            setAttachments((prev) => [...prev, attachment])
          }
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
      className="sticky bottom-0 border-t border-white/10 bg-[#0A0A0F]/90 backdrop-blur-sm md:backdrop-blur-xl p-3 md:p-4 shadow-xl md:shadow-2xl"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-purple-500/10 backdrop-blur-md z-[60] flex items-center justify-center border-2 border-dashed border-purple-500/50 rounded-2xl m-3 md:m-4 pointer-events-none">
          <div className="text-center">
            <Paperclip className="h-12 w-12 text-purple-400 mx-auto mb-2" />
            <p className="text-white font-medium">Drop files here</p>
            <p className="text-gray-400 text-sm mt-1">Images, PDFs, TXT, CSV, JSON, MD</p>
          </div>
        </div>
      )}
      <div className="max-w-4xl mx-auto">
        <div className="glass-strong rounded-xl md:rounded-2xl p-2.5 md:p-3 shadow-md md:shadow-lg hover:shadow-purple-500/10 transition-shadow">
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 md:mb-3 pb-2 md:pb-3 border-b border-white/10 overflow-x-auto">
              {attachments.map((attachment, index) => (
                <div key={index} className="relative group shrink-0">
                  {attachment.type === 'image' ? (
                    <div className="h-20 w-20 md:h-24 md:w-24 rounded-xl border-2 border-white/20 bg-black/20 overflow-hidden">
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="h-20 w-48 md:h-24 md:w-56 rounded-xl border-2 border-white/15 bg-white/5 backdrop-blur-sm p-2.5 md:p-3 flex flex-col justify-between">
                      <div className="flex items-start gap-2">
                        {getFileIcon(attachment.mimeType)}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{attachment.name}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {attachment.size ? formatFileSize(attachment.size) : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-300 uppercase tracking-wider">
                          {attachment.name.split('.').pop()}
                        </span>
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
            </div>
          )}
          <div className="flex items-end gap-2 md:gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.csv,.json,.docx,.png,.jpg,.jpeg,.webp"
              multiple
              onChange={(e) => handleFileSelect(e.target.files)}
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
              disabled={(!message.trim() && attachments.length === 0) || disabled || isLoading}
              size="icon"
              className="gradient-primary h-10 w-10 md:h-11 md:w-11 rounded-xl shrink-0 hover:shadow-lg hover:shadow-purple-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin" />
              ) : (
                <Send className="h-4 w-4 md:h-5 md:w-5" />
              )}
            </Button>
          </div>
        </div>
        <p className="text-xs text-gray-500 text-center mt-2 md:mt-2.5 hidden sm:block">
          Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-400">Enter</kbd> to send, <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-400">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  )
}
