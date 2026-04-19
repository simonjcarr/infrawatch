import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { Nav } from '@/components/shared/nav'
import { Footer } from '@/components/shared/footer'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getTier } from '@/lib/tiers'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { contacts } from '@/lib/db/schema'
import { CheckoutPanels } from './checkout-form'
import type { BillingInterval, PaidTierId } from '@/lib/tiers'

export const metadata = { title: 'Checkout' }

function isPaidTier(v: string): v is PaidTierId {
  return v === 'pro' || v === 'enterprise'
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ tier: string }>
  searchParams: Promise<{ interval?: string }>
}) {
  const { tier } = await params
  if (!isPaidTier(tier)) notFound()

  const { user } = await getRequiredSession()
  const { interval } = await searchParams
  const initialInterval: BillingInterval = interval === 'year' ? 'year' : 'month'
  const tierDef = getTier(tier)

  const technical = user.organisationId
    ? await db.query.contacts.findFirst({
        where: and(
          eq(contacts.organisationId, user.organisationId),
          eq(contacts.role, 'technical'),
        ),
      })
    : null

  return (
    <div className="flex min-h-screen flex-col">
      <Nav isAuthenticated />
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 py-12">
          <p className="mb-6 text-sm text-muted-foreground">
            You&apos;re buying as <strong className="text-foreground">{user.email}</strong>.{' '}
            {!user.organisationId ? 'You\u2019ll be asked for company details next.' : null}
          </p>

          {!technical ? (
            <Card>
              <CardHeader>
                <CardTitle>Add a technical contact first</CardTitle>
                <CardDescription>
                  This is the email that will receive the signed licence key after payment.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/account">Add technical contact</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <CheckoutPanels tier={tier} tierDef={tierDef} initialInterval={initialInterval} />
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
