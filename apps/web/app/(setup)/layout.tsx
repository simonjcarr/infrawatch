import { CarrTechLogo } from '@/components/shared/carrtech-logo'

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <CarrTechLogo className="w-48 shadow-xs ring-1 ring-border" priority />
          <h1 className="sr-only">CT-Ops</h1>
          <p className="text-sm text-muted-foreground mt-1">Let&apos;s get you set up</p>
        </div>
        {children}
      </div>
    </div>
  )
}
