// Run via: pnpm tsx apps/licence-purchase/scripts/backfill-ct-ops.ts
// After the first Stripe catalog sync has run, this script walks every
// existing CT-Ops purchase / licence row whose catalog FKs are null and fills
// them in by joining the row's denormalised `tier` + `interval` (and for
// licences, the `tier` column) against the freshly-synced product_tier_price
// rows under the `ct-ops` product.

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  licences,
  products,
  productTierPrices,
  productTiers,
  purchases,
} from '@/lib/db/schema'

const PRODUCT_SLUG = 'ct-ops'

async function main(): Promise<void> {
  const product = await db.query.products.findFirst({
    where: eq(products.slug, PRODUCT_SLUG),
  })
  if (!product) {
    console.error(
      `Product "${PRODUCT_SLUG}" not found. Run sync-stripe-catalog.ts first so the catalog exists.`,
    )
    process.exit(1)
  }

  const tiers = await db.query.productTiers.findMany({
    where: eq(productTiers.productId, product.id),
  })
  const tierBySlug = new Map(tiers.map((t) => [t.tierSlug, t]))

  const prices = await db.query.productTierPrices.findMany()
  const pricesByTier = new Map<string, typeof prices>()
  for (const price of prices) {
    const arr = pricesByTier.get(price.tierId) ?? []
    arr.push(price)
    pricesByTier.set(price.tierId, arr)
  }

  let purchasesUpdated = 0
  let licencesUpdated = 0

  const pendingPurchases = await db
    .select()
    .from(purchases)
    .where(and(isNull(purchases.productId), isNull(purchases.productTierId)))

  for (const purchase of pendingPurchases) {
    const tier = tierBySlug.get(purchase.tier)
    if (!tier) {
      console.warn(
        `Purchase ${purchase.id}: no tier "${purchase.tier}" under ${PRODUCT_SLUG} — skipping`,
      )
      continue
    }
    const price = pricesByTier
      .get(tier.id)
      ?.find((p) => p.interval === purchase.interval)
    await db
      .update(purchases)
      .set({
        productId: product.id,
        productTierId: tier.id,
        productTierPriceId: price?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(purchases.id, purchase.id))
    purchasesUpdated += 1
  }

  const pendingLicences = await db
    .select()
    .from(licences)
    .where(and(isNull(licences.productId), isNull(licences.productTierId)))

  for (const licence of pendingLicences) {
    const tier = tierBySlug.get(licence.tier)
    if (!tier) {
      console.warn(
        `Licence ${licence.id}: no tier "${licence.tier}" under ${PRODUCT_SLUG} — skipping`,
      )
      continue
    }
    await db
      .update(licences)
      .set({
        productId: product.id,
        productTierId: tier.id,
        updatedAt: new Date(),
      })
      .where(eq(licences.id, licence.id))
    licencesUpdated += 1
  }

  console.log(`Backfilled ${purchasesUpdated} purchase row(s).`)
  console.log(`Backfilled ${licencesUpdated} licence row(s).`)
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
