import type { Metadata } from 'next'
import { CarrTechLogo } from '@/components/shared/carrtech-logo'

export const metadata: Metadata = {
  title: 'Sign in',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <CarrTechLogo
            className="mx-auto flex items-center justify-center gap-3 text-2xl"
            markClassName="size-11 shrink-0"
          />
          <p className="text-sm text-muted-foreground mt-1">Infrastructure monitoring platform</p>
        </div>
        {children}
      </div>
    </div>
  )
}
