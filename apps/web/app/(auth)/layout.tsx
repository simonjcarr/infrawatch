import type { Metadata } from 'next'
import { CarrTechLogo } from '@/components/shared/carrtech-logo'

export const metadata: Metadata = {
  title: 'Sign in',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <CarrTechLogo className="w-48 shadow-xs ring-1 ring-border" priority />
          <h1 className="sr-only">CT-Ops</h1>
          <p className="text-sm text-muted-foreground mt-1">Infrastructure monitoring platform</p>
        </div>
        {children}
      </div>
    </div>
  )
}
