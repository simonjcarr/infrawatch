'use client'

import { useState } from 'react'
import { BillingToggle } from '@/components/pricing/billing-toggle'
import { TierCard } from '@/components/pricing/tier-card'
import type { BillingInterval, TierDefinition } from '@/lib/tiers'
import type { TierStripePrices } from '@/lib/stripe/prices'

export function PricingClient({
  tiers,
  stripePrices,
}: {
  tiers: TierDefinition[]
  stripePrices: Record<'pro' | 'enterprise', TierStripePrices>
}) {
  const [interval, setInterval] = useState<BillingInterval>('month')

  function stripePriceFor(tierId: string) {
    if (tierId === 'pro' || tierId === 'enterprise') {
      return stripePrices[tierId][interval]
    }
    return null
  }

  return (
    <>
      <div className="mt-8 flex justify-center">
        <BillingToggle onChange={setInterval} initialInterval={interval} />
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {tiers.map((tier) => (
          <TierCard
            key={tier.id}
            tier={tier}
            interval={interval}
            stripePrice={stripePriceFor(tier.id)}
          />
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Prices shown in GBP and exclude VAT. Annual plans are billed in one upfront payment.
      </p>
    </>
  )
}
