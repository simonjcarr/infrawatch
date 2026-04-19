import { Nav } from '@/components/shared/nav'
import { Footer } from '@/components/shared/footer'
import { PricingClient } from './pricing-client'
import { TIERS } from '@/lib/tiers'
import { getOptionalSession } from '@/lib/auth/session'
import { getTierStripePrices, type TierStripePrices } from '@/lib/stripe/prices'

export const metadata = { title: 'Pricing' }

export default async function PricingPage() {
  const [session, proPrices, enterprisePrices] = await Promise.all([
    getOptionalSession(),
    getTierStripePrices('pro'),
    getTierStripePrices('enterprise'),
  ])

  const stripePrices: Record<'pro' | 'enterprise', TierStripePrices> = {
    pro: proPrices,
    enterprise: enterprisePrices,
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Nav isAuthenticated={!!session} />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Pricing &amp; tiers</h1>
            <p className="mx-auto mt-2 max-w-prose text-muted-foreground">
              Community is free forever. Pro unlocks governance, reporting and SSO. Enterprise adds SAML,
              compliance packs and white labelling. Every paid licence is a signed JWT validated offline
              on your server.
            </p>
          </div>

          <PricingClient tiers={TIERS} stripePrices={stripePrices} />
        </div>
      </main>
      <Footer />
    </div>
  )
}
