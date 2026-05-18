'use client'

import { motion } from 'framer-motion'
import { Zap, Brain, Rocket } from 'lucide-react'
import { cn } from '@/lib/utils'
import { REASONING_PROFILES, type ReasoningMode } from '@/lib/ai/reasoning-profiles'

interface ReasoningSelectorProps {
  selectedMode: ReasoningMode
  onSelectMode: (mode: ReasoningMode) => void
  disabled?: boolean
}

const MODE_CONFIG: { mode: ReasoningMode; icon: typeof Zap; activeColor: string }[] = [
  { mode: 'instant', icon: Zap, activeColor: 'text-amber-400' },
  { mode: 'thinking', icon: Brain, activeColor: 'text-violet-400' },
  { mode: 'extended', icon: Rocket, activeColor: 'text-cyan-400' },
]

export function ReasoningSelector({ selectedMode, onSelectMode, disabled = false }: ReasoningSelectorProps) {
  return (
    <div className="flex items-center gap-0.5 bg-white/[0.03] border border-white/[0.08] rounded-xl px-1 py-0.5">
      {MODE_CONFIG.map(({ mode, icon: Icon, activeColor }) => {
        const profile = REASONING_PROFILES[mode]
        const isSelected = selectedMode === mode
        return (
          <motion.button
            key={mode}
            onClick={() => !disabled && onSelectMode(mode)}
            disabled={disabled}
            title={`${profile.label}: ${profile.description}`}
            className={cn(
              'relative px-2 md:px-2.5 py-1.5 rounded-lg text-[10px] md:text-xs font-medium transition-all duration-200',
              'flex items-center gap-1 md:gap-1.5 whitespace-nowrap',
              isSelected ? 'text-white' : 'text-gray-500 hover:text-gray-300',
              disabled && 'opacity-40 cursor-not-allowed'
            )}
            whileHover={disabled ? {} : { scale: 1.05 }}
            whileTap={disabled ? {} : { scale: 0.95 }}
          >
            {isSelected && (
              <motion.div
                className="absolute inset-0 rounded-lg bg-white/[0.06] border border-white/[0.1]"
                layoutId="reasoning-pill"
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              />
            )}
            <Icon className={cn('relative z-10 h-3 w-3 md:h-3.5 md:w-3.5', isSelected && activeColor)} />
            <span className="relative z-10 hidden sm:inline">{profile.label}</span>
          </motion.button>
        )
      })}
    </div>
  )
}
