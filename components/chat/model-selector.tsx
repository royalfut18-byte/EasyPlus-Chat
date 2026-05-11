'use client'

import { motion } from 'framer-motion'
import { AI_MODELS, type AIModel } from '@/types/models'
import { AnthropicIcon } from '@/components/icons/anthropic-icon'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModelSelectorProps {
  selectedModel: string
  onSelectModel: (modelId: string) => void
}

export function ModelSelector({ selectedModel, onSelectModel }: ModelSelectorProps) {
  const getShortName = (name: string) => {
    // Show shorter names on mobile
    return name
      .replace('Claude Opus', 'Claude')
      .replace('Claude Sonnet', 'Claude')
      .replace('Gemini 2.5 Flash', 'Gemini 2.5')
  }

  const getModelIcon = (model: AIModel) => {
    if (model.provider === 'anthropic') {
      return (
        <div className={cn(
          'w-5 h-5 md:w-7 md:h-7 rounded-lg flex items-center justify-center transition-colors',
          selectedModel === model.id
            ? 'bg-gradient-to-br from-[#d97757]/20 to-[#d97757]/10'
            : 'bg-white/5'
        )}>
          <AnthropicIcon className={cn(
            'w-3 h-3 md:w-4 md:h-4 transition-colors',
            selectedModel === model.id ? 'text-[#d97757]' : 'text-gray-400'
          )} />
        </div>
      )
    } else if (model.provider === 'google') {
      return (
        <div className={cn(
          'w-5 h-5 md:w-7 md:h-7 rounded-lg flex items-center justify-center transition-colors',
          selectedModel === model.id
            ? `bg-gradient-to-br from-[${model.color}]/20 to-[${model.color}]/10`
            : 'bg-white/5'
        )}>
          <Sparkles className={cn(
            'w-3 h-3 md:w-4 md:h-4 transition-colors',
            selectedModel === model.id ? 'text-blue-400' : 'text-gray-400'
          )} />
        </div>
      )
    }
    return <span className="text-base md:text-lg">{model.icon}</span>
  }

  return (
    <div className="flex flex-wrap gap-2 md:gap-3 py-1 md:p-0">
      {AI_MODELS.map((model) => (
        <motion.button
          key={model.id}
          onClick={() => onSelectModel(model.id)}
          className={cn(
            'relative px-2.5 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-medium transition-all duration-200',
            'border flex items-center gap-1.5 md:gap-2 h-9 md:h-auto',
            selectedModel === model.id
              ? 'border-transparent shadow-md md:shadow-lg'
              : 'border-white/10 hover:border-white/20 bg-white/5'
          )}
          style={{
            background:
              selectedModel === model.id
                ? `linear-gradient(135deg, ${model.color}40, ${model.color}20)`
                : undefined,
            boxShadow:
              selectedModel === model.id ? `0 0 15px ${model.color}40` : undefined,
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
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
          {selectedModel === model.id && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                border: `2px solid ${model.color}`,
                boxShadow: `0 0 15px ${model.color}60`,
              }}
              layoutId="model-indicator"
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          )}
        </motion.button>
      ))}
    </div>
  )
}
