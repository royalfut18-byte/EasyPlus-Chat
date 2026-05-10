'use client'

import { useState, useRef, KeyboardEvent, useEffect } from 'react'
import { Send, Loader2, Image as ImageIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChatAttachment } from '@/types/models'
import { toast } from '@/components/ui/use-toast'

interface ChatInputProps {
  onSend: (message: string, attachments?: ChatAttachment[]) => void
  disabled?: boolean
  isLoading?: boolean
}

export function ChatInput({ onSend, disabled, isLoading }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = () => {
    if ((message.trim() || attachments.length > 0) && !disabled && !isLoading) {
      onSend(message.trim(), attachments.length > 0 ? attachments : undefined)
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

  const processImageFile = async (file: File): Promise<ChatAttachment | null> => {
    const maxSize = 5 * 1024 * 1024
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']

    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Only PNG, JPG, JPEG, and WebP images are supported',
        variant: 'destructive',
      })
      return null
    }

    if (file.size > maxSize) {
      toast({
        title: 'File too large',
        description: 'Image must be smaller than 5MB',
        variant: 'destructive',
      })
      return null
    }

    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        resolve({
          type: 'image',
          name: file.name,
          mimeType: file.type,
          dataUrl,
        })
      }
      reader.onerror = () => {
        toast({
          title: 'Error reading file',
          description: 'Failed to process image',
          variant: 'destructive',
        })
        resolve(null)
      }
      reader.readAsDataURL(file)
    })
  }

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const file = files[0]
    const attachment = await processImageFile(file)
    if (attachment) {
      setAttachments((prev) => [...prev, attachment])
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
          const attachment = await processImageFile(file)
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
      className="sticky bottom-0 border-t border-white/10 bg-[#0A0A0F]/90 backdrop-blur-xl p-4 shadow-2xl"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-purple-500/10 backdrop-blur-sm z-10 flex items-center justify-center border-2 border-dashed border-purple-500/50 rounded-2xl m-4">
          <div className="text-center">
            <ImageIcon className="h-12 w-12 text-purple-500 mx-auto mb-2" />
            <p className="text-white font-medium">Drop image here</p>
          </div>
        </div>
      )}
      <div className="max-w-4xl mx-auto">
        <div className="glass-strong rounded-2xl p-3 shadow-lg hover:shadow-purple-500/10 transition-shadow">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-white/10">
              {attachments.map((attachment, index) => (
                <div key={index} className="relative group">
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.name}
                    className="h-20 w-20 object-cover rounded-lg border border-white/20"
                  />
                  <button
                    onClick={() => removeAttachment(index)}
                    className="absolute -top-2 -right-2 h-6 w-6 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-4 w-4 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              onChange={(e) => handleFileSelect(e.target.files)}
              className="hidden"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isLoading}
              className="h-11 w-11 rounded-xl shrink-0 hover:bg-white/10 text-gray-400 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ImageIcon className="h-5 w-5" />
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
                'flex-1 bg-transparent border-none outline-none resize-none text-white placeholder:text-gray-400',
                'min-h-[44px] max-h-[200px] py-3 px-2',
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
              className="gradient-primary h-11 w-11 rounded-xl shrink-0 hover:shadow-lg hover:shadow-purple-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
        <p className="text-xs text-gray-500 text-center mt-2.5">
          Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-400">Enter</kbd> to send, <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-400">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  )
}
