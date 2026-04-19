import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ShieldCheck } from 'lucide-react'
import { LogoutButton } from '@/components/shared/logout-button'
import { getOptionalSession } from '@/lib/auth/session'

// `isAuthenticated` is accepted for call sites that already compute it, but the
// nav also resolves the session itself so it can show the Admin link to
// super_admins without each page having to pass `role` through.
export async function Nav({ isAuthenticated }: { isAuthenticated?: boolean } = {}) {
  const session = await getOptionalSession()
  const authed = isAuthenticated ?? !!session
  const isSuperAdmin = session?.user.role === 'super_admin'

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
          {isSuperAdmin ? (
            <Link
              href="/admin/products"
              className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Admin
            </Link>
          ) : null}
          {authed ? (
            <>
              <Button asChild size="sm">
                <Link href="/dashboard">Dashboard</Link>
              </Button>
              <LogoutButton />
            </>
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
