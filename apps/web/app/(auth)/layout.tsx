import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">CT-Ops</h1>
          <p className="text-sm text-muted-foreground mt-1">Infrastructure monitoring platform</p>
        </div>
        {children}
      </div>
    </div>
  )
}
