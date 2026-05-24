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
    imageSize: 96,
  },
  md: {
    container: 'h-12 w-12',
    imageSize: 112,
  },
  lg: {
    container: 'h-16 w-16',
    imageSize: 144,
  },
  xl: {
    container: 'h-20 w-20',
    imageSize: 180,
  },
}

export function Logo({ size = 'md', showText = false, className }: LogoProps) {
  const config = sizeConfig[size]

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        className={cn(
          config.container,
          'rounded-xl overflow-hidden bg-[#111217] flex items-center justify-center flex-shrink-0 shadow-md ring-1 ring-white/10'
        )}
      >
        <Image
          src="/newlogo.png"
          alt="EasyPlus AI"
          width={config.imageSize}
          height={config.imageSize}
          className="h-full w-full object-cover"
          priority
        />
      </div>
      {showText && (
        <span className="font-semibold text-base md:text-lg text-white/90 whitespace-nowrap">EasyPlus AI</span>
      )}
    </div>
  )
}
