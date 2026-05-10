import { cn } from '@/lib/utils'

interface AnthropicIconProps {
  className?: string
}

export function AnthropicIcon({ className }: AnthropicIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('w-5 h-5', className)}
    >
      {/* Anthropic-style abstract mark - dual pillars design */}
      <path
        d="M9 4L6 20M15 4L18 20M9 4L12 20M15 4L12 20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
