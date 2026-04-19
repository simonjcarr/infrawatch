import { unstable_cache } from 'next/cache'
import { stripe } from './client'
import { env } from '@/lib/env'
import type { BillingInterval, PaidTierId } from '@/lib/tiers'

export type StripePriceInfo = {
  unitAmount: number // smallest currency unit (e.g. pence)
  currency: string // lowercase ISO 4217, e.g. 'gbp'
  interval: BillingInterval
}

export type TierStripePrices = {
  month: StripePriceInfo | null
  year: StripePriceInfo | null
}

async function fetchPrice(priceId: string): Promise<StripePriceInfo | null> {
  if (!priceId) return null
  try {
    const price = await stripe().prices.retrieve(priceId)
    if (price.unit_amount === null || price.unit_amount === undefined) return null
    const interval: BillingInterval = price.recurring?.interval === 'year' ? 'year' : 'month'
    return {
      unitAmount: price.unit_amount,
      currency: price.currency,
      interval,
    }
  } catch (err) {
    console.warn('[stripe] failed to fetch price', priceId, err)
    return null
  }
}

// Cache for 5 minutes per price id. We don't need tight freshness — operators
// change prices rarely, and stale pricing for a few minutes is fine.
const fetchPriceCached = unstable_cache(
  async (priceId: string) => fetchPrice(priceId),
  ['stripe-price'],
  { revalidate: 300, tags: ['stripe-prices'] },
)

export async function getTierStripePrices(tier: PaidTierId): Promise<TierStripePrices> {
  const ids = env.stripePrices[tier]
  const [month, year] = await Promise.all([
    fetchPriceCached(ids.month),
    fetchPriceCached(ids.year),
  ])
  return { month, year }
}

export function formatStripePrice(price: StripePriceInfo): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
    maximumFractionDigits: price.unitAmount % 100 === 0 ? 0 : 2,
  }).format(price.unitAmount / 100)
}
