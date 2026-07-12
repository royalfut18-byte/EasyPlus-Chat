'use client'

import { motion } from 'framer-motion'
import { AI_MODELS, UI_MODELS, type AIModel } from '@/types/models'
import { AnthropicIcon } from '@/components/icons/anthropic-icon'
import { ChatGPTIcon } from '@/components/icons/chatgpt-icon'
import { Check, ChevronDown, Code2, ImageIcon, Sparkles, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ModelSelectorProps {
  selectedModel: string
  onSelectModel: (modelId: string) => void
  availableModelIds: string[] | null
  disabled?: boolean
  disabledReason?: string
}

export function ModelSelector({ selectedModel, onSelectModel, availableModelIds, disabled = false, disabledReason }: ModelSelectorProps) {
  const activeModel = AI_MODELS.find(model => model.id === selectedModel) || AI_MODELS[0]
  const isAvailable = (model: AIModel) => availableModelIds === null || availableModelIds.includes(model.id)
  const isConfirmedUnavailable = (model: AIModel) => availableModelIds !== null && !availableModelIds.includes(model.id)

  const getSelectedGlow = (model: AIModel) => {
    if (selectedModel !== model.id) return undefined
    const color = model.id === 'chat-gpt-5.6'
      ? '16, 163, 127'
      : model.id === 'claude-opus-4.8'
        ? '217, 119, 87'
        : model.id === 'deepseek-v4-pro'
          ? '167, 139, 250'
          : model.id === 'image-generation'
            ? '236, 72, 153'
            : '96, 165, 250'
    return { boxShadow: `0 0 18px rgba(${color}, 0.22), 0 0 0 1px rgba(${color}, 0.14)` }
  }

  const getShortName = (name: string) => {
    return name
      .replace('Claude Opus', 'Claude')
      .replace('Chat GPT 5.6', 'GPT 5.6')
      .replace('Gemini 3.1 Pro', 'Gemini 3.1')
      .replace('DeepSeek V4 Pro', 'DeepSeek V4')
      .replace('Image Generation', 'Image Gen')
  }

  const getModelIcon = (model: AIModel) => {
    const iconClassName = cn(
      'h-3 w-3 transition-colors md:h-3.5 md:w-3.5',
      selectedModel === model.id
        ? model.id === 'chat-gpt-5.6'
          ? 'text-[#10a37f]'
          : model.id === 'claude-opus-4.8'
            ? 'text-[#d97757]'
            : model.id === 'deepseek-v4-pro'
              ? 'text-clay-300'
              : model.id === 'image-generation'
                ? 'text-pink-300'
                : 'text-blue-400'
        : 'text-gray-400'
    )

    return (
      <div className={cn(
        'flex h-5 w-5 items-center justify-center rounded-md transition-colors',
        selectedModel === model.id ? 'bg-white/[0.08]' : 'bg-transparent'
      )}>
        {model.id === 'chat-gpt-5.6' ? (
          <ChatGPTIcon className={iconClassName} />
        ) : model.id === 'claude-opus-4.8' ? (
          <AnthropicIcon className={iconClassName} />
        ) : model.id === 'deepseek-v4-pro' ? (
          <Code2 className={iconClassName} />
        ) : model.id === 'image-generation' ? (
          <ImageIcon className={iconClassName} />
        ) : (
          <Sparkles className={iconClassName} />
        )}
      </div>
    )
  }

  return (
    <>
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              title={disabled ? (disabledReason || 'Start a new chat to switch models') : 'Switch model'}
              className={cn(
                'flex h-8 max-w-[148px] items-center gap-1 rounded-full border border-white/[0.10] bg-white/[0.06] px-2 text-xs font-medium text-white',
                disabled && 'cursor-not-allowed opacity-60'
              )}
              style={getSelectedGlow(activeModel)}
            >
              {getModelIcon(activeModel)}
              <span className="truncate">{getShortName(activeModel.name)}</span>
              {disabled ? <Lock className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0 text-gray-400" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 border-white/[0.08] bg-[#202020]">
            {UI_MODELS.map(model => (
              <DropdownMenuItem
                key={model.id}
                disabled={isConfirmedUnavailable(model)}
                onSelect={() => isAvailable(model) && onSelectModel(model.id)}
                className="flex cursor-pointer items-center gap-2 text-gray-200 focus:bg-white/[0.07] focus:text-white"
              >
                {getModelIcon(model)}
                <span className="flex-1">
                  {getShortName(model.name)}
                  {model.description && <span className="mt-0.5 block text-[10px] leading-tight text-gray-500">{model.description}</span>}
                </span>
                {isConfirmedUnavailable(model) && <span className="text-[10px] text-gray-500">Unavailable</span>}
                {selectedModel === model.id && <Check className="h-4 w-4 text-clay-300" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="hidden flex-wrap items-center gap-1 md:flex">
      {disabled && (
        <div className="flex items-center gap-2 text-xs text-gray-400 px-2 py-1">
          <Lock className="w-3 h-3" />
          <span className="hidden md:inline">{disabledReason || 'Model locked for this chat'}</span>
        </div>
      )}
      {UI_MODELS.map((model) => (
        <motion.button
          key={model.id}
          onClick={() => !disabled && isAvailable(model) && onSelectModel(model.id)}
          disabled={disabled || isConfirmedUnavailable(model)}
          title={isConfirmedUnavailable(model) ? `${model.name} is temporarily unavailable` : disabled ? (disabledReason || 'Start a new chat to switch models') : model.description}
          className={cn(
            'relative flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors md:px-3',
            selectedModel === model.id
              ? 'border-white/[0.10] bg-white/[0.06]'
              : 'border-transparent bg-transparent hover:bg-white/[0.045]',
            (disabled || isConfirmedUnavailable(model)) && 'opacity-60 cursor-not-allowed'
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
    </>
  )
}
