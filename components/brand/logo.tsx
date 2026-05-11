import Image from 'next/image'
import { cn } from '@/lib/utils'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showText?: boolean
  className?: string
}

const sizeConfig = {
  sm: {
    container: 'h-11 w-11',
    imageSize: 64,
    scale: 'scale-[1.2]',
  },
  md: {
    container: 'h-12 w-12',
    imageSize: 72,
    scale: 'scale-[1.25]',
  },
  lg: {
    container: 'h-16 w-16',
    imageSize: 96,
    scale: 'scale-[1.25]',
  },
  xl: {
    container: 'h-20 w-20',
    imageSize: 120,
    scale: 'scale-[1.25]',
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
          width={config.imageSize}
          height={config.imageSize}
          className={cn('object-contain', config.scale)}
          priority
        />
      </div>
      {showText && (
        <span className="font-bold text-base md:text-lg gradient-text whitespace-nowrap">EasyPlus AI</span>
      )}
    </div>
  )
}
