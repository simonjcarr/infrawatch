import type { ReactNode } from 'react'
import Link from 'next/link'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { Nav } from '@/components/shared/nav'
import { Footer } from '@/components/shared/footer'

export const metadata = { title: 'Admin' }

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin()

  return (
    <div className="flex min-h-screen flex-col">
      <Nav isAuthenticated />
      <div className="border-b bg-muted/40">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2 text-sm">
          <span className="font-medium text-foreground">Admin</span>
          <Link
            href="/admin/products"
            className="text-muted-foreground hover:text-foreground"
          >
            Products
          </Link>
        </div>
      </div>
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}
