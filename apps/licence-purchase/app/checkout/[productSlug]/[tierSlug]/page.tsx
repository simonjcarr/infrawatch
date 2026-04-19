import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { Nav } from '@/components/shared/nav'
import { Footer } from '@/components/shared/footer'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { contacts } from '@/lib/db/schema'
import { getActiveProductBySlug, listTiersForProduct } from '@/lib/catalog/queries'
import { CheckoutPanels } from './checkout-form'
import type { BillingInterval } from '@/lib/billing'

export const metadata = { title: 'Checkout' }

type Params = Promise<{ productSlug: string; tierSlug: string }>
type Search = Promise<{ interval?: string }>

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: Search
}) {
  const { productSlug, tierSlug } = await params
  const { interval } = await searchParams
  const initialInterval: BillingInterval = interval === 'year' ? 'year' : 'month'

  const product = await getActiveProductBySlug(productSlug)
  if (!product) notFound()

  const tiers = await listTiersForProduct(product.id, { activeOnly: true })
  const tier = tiers.find((t) => t.tierSlug === tierSlug)
  if (!tier) notFound()

  const { user } = await getRequiredSession()

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
            <CheckoutPanels
              productSlug={product.slug}
              productName={product.name}
              tierSlug={tier.tierSlug}
              tierName={tier.name}
              prices={tier.prices}
              initialInterval={initialInterval}
            />
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
