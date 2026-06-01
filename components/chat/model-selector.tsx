'use client'

import { motion } from 'framer-motion'
import { AI_MODELS, type AIModel } from '@/types/models'
import { AnthropicIcon } from '@/components/icons/anthropic-icon'
import { ChatGPTIcon } from '@/components/icons/chatgpt-icon'
import { Sparkles, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModelSelectorProps {
  selectedModel: string
  onSelectModel: (modelId: string) => void
  disabled?: boolean
  disabledReason?: string
}

export function ModelSelector({ selectedModel, onSelectModel, disabled = false, disabledReason }: ModelSelectorProps) {
  const getSelectedGlow = (model: AIModel) => {
    if (selectedModel !== model.id) return undefined
    const color = model.id === 'chat-gpt-5.5'
      ? '16, 163, 127'
      : model.id === 'claude-opus-4.8'
        ? '217, 119, 87'
        : '96, 165, 250'
    return { boxShadow: `0 0 18px rgba(${color}, 0.22), 0 0 0 1px rgba(${color}, 0.14)` }
  }

  const getShortName = (name: string) => {
    return name
      .replace('Claude Opus', 'Claude')
      .replace('Chat GPT 5.5', 'GPT 5.5')
      .replace('Gemini 3.1 Pro', 'Gemini 3.1')
  }

  const getModelIcon = (model: AIModel) => {
    const iconClassName = cn(
      'h-3 w-3 transition-colors md:h-3.5 md:w-3.5',
      selectedModel === model.id
        ? model.id === 'chat-gpt-5.5'
          ? 'text-[#10a37f]'
          : model.id === 'claude-opus-4.8'
            ? 'text-[#d97757]'
            : 'text-blue-400'
        : 'text-gray-400'
    )

    return (
      <div className={cn(
        'flex h-5 w-5 items-center justify-center rounded-md transition-colors',
        selectedModel === model.id ? 'bg-white/[0.08]' : 'bg-transparent'
      )}>
        {model.id === 'chat-gpt-5.5' ? (
          <ChatGPTIcon className={iconClassName} />
        ) : model.id === 'claude-opus-4.8' ? (
          <AnthropicIcon className={iconClassName} />
        ) : (
          <Sparkles className={iconClassName} />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {disabled && (
        <div className="flex items-center gap-2 text-xs text-gray-400 px-2 py-1">
          <Lock className="w-3 h-3" />
          <span className="hidden md:inline">{disabledReason || 'Model locked for this chat'}</span>
        </div>
      )}
      {AI_MODELS.map((model) => (
        <motion.button
          key={model.id}
          onClick={() => !disabled && onSelectModel(model.id)}
          disabled={disabled}
          title={disabled ? (disabledReason || 'Start a new chat to switch models') : undefined}
          className={cn(
            'relative flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors md:px-3',
            selectedModel === model.id
              ? 'border-white/[0.10] bg-white/[0.06]'
              : 'border-transparent bg-transparent hover:bg-white/[0.045]',
            disabled && 'opacity-60 cursor-not-allowed'
          )}
          style={getSelectedGlow(model)}
          whileTap={disabled ? {} : { scale: 0.98 }}
        >
          {getModelIcon(model)}
          <span
            className={cn(
              'transition-colors whitespace-nowrap',
              selectedModel === model.id ? 'text-white' : 'text-gray-300'
            )}
          >
            <span className="md:hidden">{getShortName(model.name)}</span>
            <span className="hidden md:inline">{model.name}</span>
          </span>
          {selectedModel === model.id && disabled && (
            <Lock className="w-3 h-3 ml-1" />
          )}
        </motion.button>
      ))}
    </div>
  )
}
