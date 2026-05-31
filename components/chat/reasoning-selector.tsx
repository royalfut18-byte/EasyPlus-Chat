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
    <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-black/10 p-0.5">
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
              'relative rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors md:px-2.5 md:text-xs',
              'flex items-center gap-1 md:gap-1.5 whitespace-nowrap',
              isSelected ? 'text-white' : 'text-gray-500 hover:text-gray-300',
              disabled && 'opacity-40 cursor-not-allowed'
            )}
            whileTap={disabled ? {} : { scale: 0.98 }}
          >
            {isSelected && (
              <motion.div
                className="absolute inset-0 rounded-md border border-violet-400/20 bg-violet-500/10"
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
