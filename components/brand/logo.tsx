import Image from 'next/image'
import { cn } from '@/lib/utils'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showText?: boolean
  className?: string
}

const sizeConfig = {
  sm: {
    container: 'h-8 w-8',
    image: 'h-9 w-9',
    imageSize: 36,
  },
  md: {
    container: 'h-10 w-10',
    image: 'h-11 w-11',
    imageSize: 44,
  },
  lg: {
    container: 'h-12 w-12',
    image: 'h-13 w-13',
    imageSize: 52,
  },
  xl: {
    container: 'h-20 w-20',
    image: 'h-22 w-22',
    imageSize: 88,
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
          className={cn(config.image, 'object-contain scale-[1.15]')}
          priority
        />
      </div>
      {showText && (
        <span className="font-bold text-lg gradient-text">EasyPlus AI</span>
      )}
    </div>
  )
}
