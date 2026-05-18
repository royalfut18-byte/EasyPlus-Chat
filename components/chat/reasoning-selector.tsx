'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { REASONING_PROFILES, type ReasoningMode } from '@/lib/ai/reasoning-profiles'

interface ReasoningSelectorProps {
  selectedMode: ReasoningMode
  onSelectMode: (mode: ReasoningMode) => void
  disabled?: boolean
}

const MODES: ReasoningMode[] = ['instant', 'thinking', 'extended']

export function ReasoningSelector({ selectedMode, onSelectMode, disabled = false }: ReasoningSelectorProps) {
  return (
    <div className="flex items-center gap-1 md:gap-1.5 bg-white/[0.02] border border-white/[0.06] rounded-full px-1 py-0.5 md:px-1.5 md:py-1">
      {MODES.map((mode) => {
        const profile = REASONING_PROFILES[mode]
        const isSelected = selectedMode === mode
        return (
          <motion.button
            key={mode}
            onClick={() => !disabled && onSelectMode(mode)}
            disabled={disabled}
            title={disabled ? 'Start a new chat to change mode' : profile.description}
            className={cn(
              'relative px-2 md:px-3 py-1 md:py-1.5 rounded-full text-[10px] md:text-xs font-medium transition-all duration-200',
              'flex items-center gap-1 md:gap-1.5 whitespace-nowrap',
              isSelected
                ? 'text-white'
                : 'text-gray-400 hover:text-gray-200',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
            whileHover={disabled ? {} : { scale: 1.03 }}
            whileTap={disabled ? {} : { scale: 0.97 }}
          >
            {isSelected && (
              <motion.div
                className="absolute inset-0 rounded-full bg-white/[0.08] border border-white/[0.12]"
                layoutId="reasoning-indicator"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">{profile.emoji}</span>
            <span className="relative z-10 hidden sm:inline">{profile.label}</span>
          </motion.button>
        )
      })}
    </div>
  )
}
