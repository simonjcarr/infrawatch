import { redirect } from 'next/navigation'
import { and, desc, eq, gte, isNull } from 'drizzle-orm'
import { Nav } from '@/components/shared/nav'
import { Footer } from '@/components/shared/footer'
import { AwaitLicence } from '@/components/licence/await-licence'
import { getOptionalSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { licences } from '@/lib/db/schema'

export const metadata = { title: 'Purchase complete' }

// Customer lands here right after Stripe Checkout returns. If the webhook has
// already issued the licence we redirect straight to the dashboard; otherwise
// a client component polls until it appears and then redirects.
async function hasRecentLicence(organisationId: string | null): Promise<boolean> {
  if (!organisationId) return false
  const cutoff = new Date(Date.now() - 60 * 60 * 1000)
  const row = await db.query.licences.findFirst({
    where: and(
      eq(licences.organisationId, organisationId),
      isNull(licences.revokedAt),
      gte(licences.issuedAt, cutoff),
    ),
    orderBy: [desc(licences.issuedAt)],
    columns: { id: true },
  })
  return !!row
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ method?: string; tier?: string }>
}) {
  const { method, tier } = await searchParams
  const session = await getOptionalSession()
  const licenceReady = await hasRecentLicence(session?.user.organisationId ?? null)

  if (licenceReady) {
    redirect('/dashboard')
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Nav isAuthenticated={!!session} />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-4 py-16">
          <AwaitLicence tier={tier} isInvoiceFlow={method === 'invoice'} />
        </div>
      </main>
      <Footer />
    </div>
  )
}
