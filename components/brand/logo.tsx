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
    image: 'h-12 w-12',
    imageSize: 48,
  },
  md: {
    container: 'h-14 w-14',
    image: 'h-16 w-16',
    imageSize: 64,
  },
  lg: {
    container: 'h-16 w-16',
    image: 'h-20 w-20',
    imageSize: 80,
  },
  xl: {
    container: 'h-24 w-24',
    image: 'h-28 w-28',
    imageSize: 112,
  },
}

export function Logo({ size = 'md', showText = false, className }: LogoProps) {
  const config = sizeConfig[size]

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        className={cn(
          config.container,
          'rounded-2xl overflow-hidden bg-white flex items-center justify-center flex-shrink-0 shadow-lg border border-white/10'
        )}
      >
        <Image
          src="/logo.png"
          alt="EasyPlus AI"
          width={config.imageSize}
          height={config.imageSize}
          className={cn(config.image, 'object-contain scale-125')}
          priority
        />
      </div>
      {showText && (
        <span className="font-bold text-lg gradient-text">EasyPlus AI</span>
      )}
    </div>
  )
}
