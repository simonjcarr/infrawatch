import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ShieldCheck } from 'lucide-react'

export function Nav({ isAuthenticated }: { isAuthenticated?: boolean }) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-foreground">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          <span>Infrawatch Licensing</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/products" className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            Products
          </Link>
          <Link href="/#trust" className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            Security
          </Link>
          <Link href="https://docs.infrawatch.io" className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            Docs
          </Link>
          {isAuthenticated ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/register">Create account</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
