import Image from 'next/image'
import { cn } from '@/lib/utils'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showText?: boolean
  className?: string
}

const sizeConfig = {
  sm: {
    container: 'h-10 w-10',
    image: 32,
  },
  md: {
    container: 'h-12 w-12',
    image: 40,
  },
  lg: {
    container: 'h-16 w-16',
    image: 56,
  },
  xl: {
    container: 'h-16 w-16',
    image: 56,
  },
}

export function Logo({ size = 'md', showText = false, className }: LogoProps) {
  const config = sizeConfig[size]

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        className={cn(
          config.container,
          'rounded-xl overflow-hidden bg-white flex items-center justify-center flex-shrink-0 shadow-md'
        )}
      >
        <Image
          src="/logo.png"
          alt="EasyPlus AI"
          width={config.image}
          height={config.image}
          className="object-contain"
          priority
        />
      </div>
      {showText && (
        <span className="font-bold text-base md:text-lg gradient-text whitespace-nowrap">EasyPlus AI</span>
      )}
    </div>
  )
}
