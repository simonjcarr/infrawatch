import { CarrTechLogo } from '@/components/shared/carrtech-logo'

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <CarrTechLogo
            className="mx-auto flex items-center justify-center gap-3 text-2xl"
            markClassName="size-11 shrink-0"
          />
          <p className="text-sm text-muted-foreground mt-1">Let&apos;s get you set up</p>
        </div>
        {children}
      </div>
    </div>
  )
}
