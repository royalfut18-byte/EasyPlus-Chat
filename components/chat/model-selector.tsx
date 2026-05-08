'use client'

import { motion } from 'framer-motion'
import { AI_MODELS, type AIModel } from '@/types/models'
import { cn } from '@/lib/utils'

interface ModelSelectorProps {
  selectedModel: string
  onSelectModel: (modelId: string) => void
}

export function ModelSelector({ selectedModel, onSelectModel }: ModelSelectorProps) {
  return (
    <div className="flex flex-wrap gap-3 p-4">
      {AI_MODELS.map((model) => (
        <motion.button
          key={model.id}
          onClick={() => onSelectModel(model.id)}
          className={cn(
            'relative px-4 py-2 rounded-full text-sm font-medium transition-all duration-200',
            'border flex items-center gap-2',
            selectedModel === model.id
              ? 'border-transparent shadow-lg'
              : 'border-white/10 hover:border-white/20 bg-white/5'
          )}
          style={{
            background:
              selectedModel === model.id
                ? `linear-gradient(135deg, ${model.color}40, ${model.color}20)`
                : undefined,
            boxShadow:
              selectedModel === model.id ? `0 0 20px ${model.color}40` : undefined,
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="text-lg">{model.icon}</span>
          <span
            className={cn(
              'transition-colors',
              selectedModel === model.id ? 'text-white' : 'text-gray-300'
            )}
          >
            {model.name}
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
