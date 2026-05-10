'use client'

import { useState, useRef, KeyboardEvent } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  isLoading?: boolean
}

export function ChatInput({ onSend, disabled, isLoading }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    if (message.trim() && !disabled && !isLoading) {
      onSend(message.trim())
      setMessage('')
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

  return (
    <div className="sticky bottom-0 border-t border-white/10 bg-[#0A0A0F]/90 backdrop-blur-xl p-4 shadow-2xl">
      <div className="max-w-4xl mx-auto">
        <div className="glass-strong rounded-2xl p-3 flex items-end gap-3 shadow-lg hover:shadow-purple-500/10 transition-shadow">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
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
            disabled={!message.trim() || disabled || isLoading}
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
        <p className="text-xs text-gray-500 text-center mt-2.5">
          Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-400">Enter</kbd> to send, <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-400">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  )
}
