import Image from 'next/image'
import { cn } from '@/lib/utils'

type CarrTechLogoProps = {
  className?: string
  priority?: boolean
}

export function CarrTechLogo({ className, priority = false }: CarrTechLogoProps) {
  return (
    <Image
      src="/carrtech-logo.png"
      alt="CT-Ops"
      width={1536}
      height={1024}
      priority={priority}
      className={cn('h-auto rounded-sm bg-white', className)}
    />
  )
}
