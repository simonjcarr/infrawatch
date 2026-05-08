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
      alt="CarrTech"
      width={946}
      height={666}
      priority={priority}
      className={cn('h-auto rounded-sm bg-white', className)}
    />
  )
}
