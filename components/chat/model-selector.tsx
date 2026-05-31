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
  const getShortName = (name: string) => {
    return name
      .replace('Claude Opus', 'Claude')
      .replace('Chat GPT 5.5', 'GPT 5.5')
      .replace('Gemini 3.1 Pro', 'Gemini 3.1')
  }

  const getModelIcon = (model: AIModel) => {
    const iconClassName = cn(
      'w-3 h-3 md:w-4 md:h-4 transition-colors',
      selectedModel === model.id
        ? model.id === 'chat-gpt-5.5'
          ? 'text-[#10a37f]'
          : model.id === 'claude-opus-4.7'
            ? 'text-[#d97757]'
            : 'text-blue-400'
        : 'text-gray-400'
    )

    return (
      <div className={cn(
        'w-5 h-5 md:w-7 md:h-7 rounded-lg flex items-center justify-center transition-colors',
        selectedModel === model.id ? 'bg-white/10' : 'bg-white/5'
      )}>
        {model.id === 'chat-gpt-5.5' ? (
          <ChatGPTIcon className={iconClassName} />
        ) : model.id === 'claude-opus-4.7' ? (
          <AnthropicIcon className={iconClassName} />
        ) : (
          <Sparkles className={iconClassName} />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2 md:gap-3 py-1 md:p-0">
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
            'relative px-2.5 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-medium transition-all duration-200',
            'border flex items-center gap-1.5 md:gap-2 h-9 md:h-auto',
            selectedModel === model.id
              ? 'border-white/[0.12] bg-white/[0.06]'
              : 'border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02]',
            disabled && 'opacity-60 cursor-not-allowed'
          )}
          style={{
            background:
              selectedModel === model.id
                ? `linear-gradient(135deg, ${model.color}15, ${model.color}08)`
                : undefined,
            boxShadow:
              selectedModel === model.id ? `0 0 10px ${model.color}20` : undefined,
          }}
          whileHover={disabled ? {} : { scale: 1.05 }}
          whileTap={disabled ? {} : { scale: 0.95 }}
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
          {selectedModel === model.id && !disabled && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                border: `1px solid ${model.color}50`,
                boxShadow: `0 0 8px ${model.color}20`,
              }}
              layoutId="model-indicator"
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          )}
          {selectedModel === model.id && disabled && (
            <Lock className="w-3 h-3 ml-1" />
          )}
        </motion.button>
      ))}
    </div>
  )
}
