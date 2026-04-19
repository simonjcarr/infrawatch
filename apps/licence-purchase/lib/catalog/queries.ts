import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { products, productTiers, productTierPrices } from '@/lib/db/schema'
import type { Product, ProductTier, ProductTierPrice } from '@/lib/db/schema'

// Public product listing. Supports a simple free-text search over the
// Postgres tsvector column. Empty query returns all active products.
export async function listActiveProducts(query?: string | null): Promise<Product[]> {
  const trimmed = query?.trim()
  if (trimmed) {
    return db
      .select()
      .from(products)
      .where(
        and(
          eq(products.isActive, true),
          sql`${products.searchTsv} @@ websearch_to_tsquery('english', ${trimmed})`,
        ),
      )
      .orderBy(
        sql`ts_rank(${products.searchTsv}, websearch_to_tsquery('english', ${trimmed})) desc`,
        asc(products.displayOrder),
        asc(products.name),
      )
  }
  return db
    .select()
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(asc(products.displayOrder), asc(products.name))
}

export async function getActiveProductBySlug(slug: string): Promise<Product | null> {
  const row = await db.query.products.findFirst({
    where: and(eq(products.slug, slug), eq(products.isActive, true)),
  })
  return row ?? null
}

// Counts tiers + active prices for a product (admin table).
export async function countTiersAndPrices(
  productId: string,
): Promise<{ tierCount: number; activePriceCount: number }> {
  const [tiersRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productTiers)
    .where(eq(productTiers.productId, productId))
  const [pricesRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productTierPrices)
    .innerJoin(productTiers, eq(productTierPrices.tierId, productTiers.id))
    .where(and(eq(productTiers.productId, productId), eq(productTierPrices.isActive, true)))
  return {
    tierCount: Number(tiersRow?.count ?? 0),
    activePriceCount: Number(pricesRow?.count ?? 0),
  }
}

export type TierWithPrices = ProductTier & { prices: ProductTierPrice[] }

export async function listTiersForProduct(
  productId: string,
  options: { activeOnly?: boolean } = {},
): Promise<TierWithPrices[]> {
  const where = options.activeOnly
    ? and(eq(productTiers.productId, productId), eq(productTiers.isActive, true))
    : eq(productTiers.productId, productId)

  const tiers = await db
    .select()
    .from(productTiers)
    .where(where)
    .orderBy(asc(productTiers.tierOrder), asc(productTiers.name))

  if (tiers.length === 0) return []

  const tierIds = tiers.map((t) => t.id)
  const prices = await db
    .select()
    .from(productTierPrices)
    .where(
      options.activeOnly
        ? and(
            eq(productTierPrices.isActive, true),
            sql`${productTierPrices.tierId} = ANY(${tierIds})`,
          )
        : sql`${productTierPrices.tierId} = ANY(${tierIds})`,
    )

  const byTier = new Map<string, ProductTierPrice[]>()
  for (const price of prices) {
    const arr = byTier.get(price.tierId) ?? []
    arr.push(price)
    byTier.set(price.tierId, arr)
  }
  return tiers.map((t) => ({ ...t, prices: byTier.get(t.id) ?? [] }))
}
