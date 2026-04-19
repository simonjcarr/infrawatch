'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Check } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BillingToggle } from '@/components/pricing/billing-toggle'
import { formatPrice, type BillingInterval } from '@/lib/billing'
import type { TierWithPrices } from '@/lib/catalog/queries'

export function ProductDetail({
  productSlug,
  tiers,
}: {
  productSlug: string
  tiers: TierWithPrices[]
}) {
  const [interval, setInterval] = useState<BillingInterval>('month')

  if (tiers.length === 0) {
    return (
      <p className="mt-10 text-center text-muted-foreground">
        No active plans for this product yet.
      </p>
    )
  }

  return (
    <>
      <div className="mt-8 flex justify-center">
        <BillingToggle onChange={setInterval} initialInterval={interval} />
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {tiers.map((tier) => {
          const price = tier.prices.find((p) => p.interval === interval && p.isActive)
          const priceLabel = price ? formatPrice(price.unitAmount, price.currency) : null
          const intervalSuffix = interval === 'year' ? '/ year' : '/ month'

          return (
            <Card key={tier.id} className="h-full">
              <CardHeader>
                <CardTitle className="text-lg">{tier.name}</CardTitle>
                {tier.description ? <CardDescription>{tier.description}</CardDescription> : null}
              </CardHeader>
              <CardContent className="flex h-full flex-col gap-6">
                <div>
                  {priceLabel ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-semibold tracking-tight text-foreground">
                        {priceLabel}
                      </span>
                      <span className="text-sm text-muted-foreground">{intervalSuffix}</span>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No {interval} price configured
                    </div>
                  )}
                </div>

                <Button asChild disabled={!priceLabel} className="w-full">
                  <Link href={`/checkout/${productSlug}/${tier.tierSlug}?interval=${interval}`}>
                    Buy {tier.name}
                  </Link>
                </Button>

                {tier.features.length > 0 ? (
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Features
                    </div>
                    <ul className="space-y-2 text-sm">
                      {tier.features.map((f) => (
                        <li key={f} className="flex gap-2 text-foreground">
                          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )
}
