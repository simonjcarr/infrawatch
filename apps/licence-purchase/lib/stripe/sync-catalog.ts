import type Stripe from 'stripe'
import { eq, inArray, notInArray, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  products,
  productTiers,
  productTierPrices,
  catalogSyncLog,
} from '@/lib/db/schema'
import type { NewCatalogSyncLog } from '@/lib/db/schema'
import { stripe } from './client'

export type SyncTrigger = 'manual' | 'webhook' | 'cli'

export type SyncResult = {
  productsUpserted: number
  tiersUpserted: number
  pricesUpserted: number
  tiersDeactivated: number
  pricesDeactivated: number
  warnings: string[]
}

type ParsedMetadata = {
  productSlug: string
  productName: string | null
  tierSlug: string
  tierOrder: number
  features: string[]
}

function parseMetadata(
  product: Stripe.Product,
  warnings: string[],
): ParsedMetadata | null {
  const meta = product.metadata ?? {}
  const productSlug = meta['carrtech_product']
  if (!productSlug) return null

  const tierSlug = meta['tier']
  if (!tierSlug) {
    warnings.push(`Stripe product ${product.id} has carrtech_product but no tier metadata`)
    return null
  }

  let features: string[] = []
  const raw = meta['features']
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((f) => typeof f === 'string')) {
        features = parsed
      } else {
        warnings.push(`Stripe product ${product.id} features metadata is not a string[]`)
      }
    } catch {
      warnings.push(`Stripe product ${product.id} features metadata is not valid JSON`)
    }
  }

  const orderRaw = meta['tier_order']
  const tierOrder = orderRaw ? Number.parseInt(orderRaw, 10) : 0

  return {
    productSlug,
    productName: meta['carrtech_product_name'] ?? null,
    tierSlug,
    tierOrder: Number.isFinite(tierOrder) ? tierOrder : 0,
    features,
  }
}

async function upsertProduct(
  parsed: ParsedMetadata,
  now: Date,
): Promise<string> {
  const existing = await db.query.products.findFirst({
    where: eq(products.slug, parsed.productSlug),
  })
  if (existing) {
    await db
      .update(products)
      .set({
        // Only refresh Stripe-sourced fields. Never overwrite admin-owned
        // `description`, `displayOrder`, `isActive`.
        name: parsed.productName ?? existing.name,
        stripeMetadataName: parsed.productName,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(products.id, existing.id))
    return existing.id
  }
  const [inserted] = await db
    .insert(products)
    .values({
      slug: parsed.productSlug,
      name: parsed.productName ?? parsed.productSlug,
      stripeMetadataName: parsed.productName,
      lastSyncedAt: now,
    })
    .returning()
  if (!inserted) throw new Error(`Failed to insert product ${parsed.productSlug}`)
  return inserted.id
}

async function upsertTier(
  product: Stripe.Product,
  parsed: ParsedMetadata,
  productId: string,
  now: Date,
): Promise<string> {
  const existing = await db.query.productTiers.findFirst({
    where: eq(productTiers.stripeProductId, product.id),
  })
  if (existing) {
    await db
      .update(productTiers)
      .set({
        productId,
        tierSlug: parsed.tierSlug,
        name: product.name,
        tierOrder: parsed.tierOrder,
        features: parsed.features,
        description: product.description ?? null,
        lastSyncedAt: now,
        updatedAt: now,
        // Leave `isActive` untouched — admin may have disabled it locally.
      })
      .where(eq(productTiers.id, existing.id))
    return existing.id
  }
  const [inserted] = await db
    .insert(productTiers)
    .values({
      productId,
      stripeProductId: product.id,
      tierSlug: parsed.tierSlug,
      name: product.name,
      tierOrder: parsed.tierOrder,
      features: parsed.features,
      description: product.description ?? null,
      lastSyncedAt: now,
    })
    .returning()
  if (!inserted) throw new Error(`Failed to insert tier for ${product.id}`)
  return inserted.id
}

async function upsertPrice(
  price: Stripe.Price,
  tierId: string,
  now: Date,
  warnings: string[],
): Promise<string | null> {
  if (price.unit_amount === null || price.unit_amount === undefined) {
    warnings.push(`Stripe price ${price.id} has no unit_amount — skipping`)
    return null
  }
  if (!price.recurring) {
    warnings.push(`Stripe price ${price.id} is not recurring — skipping`)
    return null
  }
  const interval = price.recurring.interval === 'year' ? 'year' : 'month'

  const existing = await db.query.productTierPrices.findFirst({
    where: eq(productTierPrices.stripePriceId, price.id),
  })
  if (existing) {
    await db
      .update(productTierPrices)
      .set({
        tierId,
        interval,
        currency: price.currency,
        unitAmount: price.unit_amount,
        isActive: price.active,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(productTierPrices.id, existing.id))
    return existing.id
  }
  const [inserted] = await db
    .insert(productTierPrices)
    .values({
      tierId,
      stripePriceId: price.id,
      interval,
      currency: price.currency,
      unitAmount: price.unit_amount,
      isActive: price.active,
      lastSyncedAt: now,
    })
    .returning()
  return inserted?.id ?? null
}

async function syncProductAndPrices(
  product: Stripe.Product,
  warnings: string[],
  now: Date,
): Promise<{
  productUpserted: boolean
  tierUpserted: boolean
  pricesUpserted: number
  pricesDeactivated: number
  syncedPriceIds: string[]
  tierId: string | null
} | null> {
  const parsed = parseMetadata(product, warnings)
  if (!parsed) return null

  const productId = await upsertProduct(parsed, now)
  const tierId = await upsertTier(product, parsed, productId, now)

  let pricesUpserted = 0
  const syncedPriceIds: string[] = []
  for await (const price of stripe().prices.list({ product: product.id, limit: 100 })) {
    if (!price.active) continue
    const id = await upsertPrice(price, tierId, now, warnings)
    if (id) {
      pricesUpserted += 1
      syncedPriceIds.push(price.id)
    }
  }

  // Deactivate any rows for this tier whose Stripe price is no longer active
  // (or was deleted entirely).
  const knownPrices = await db.query.productTierPrices.findMany({
    where: eq(productTierPrices.tierId, tierId),
  })
  const stalePriceIds = knownPrices
    .filter((p) => p.isActive && !syncedPriceIds.includes(p.stripePriceId))
    .map((p) => p.id)
  let pricesDeactivated = 0
  if (stalePriceIds.length > 0) {
    await db
      .update(productTierPrices)
      .set({ isActive: false, lastSyncedAt: now, updatedAt: now })
      .where(inArray(productTierPrices.id, stalePriceIds))
    pricesDeactivated = stalePriceIds.length
  }

  if (pricesUpserted === 0) {
    warnings.push(`Tier ${product.id} (${parsed.tierSlug}) has no active prices`)
  }

  return {
    productUpserted: true,
    tierUpserted: true,
    pricesUpserted,
    pricesDeactivated,
    syncedPriceIds,
    tierId,
  }
}

// Full catalog sync. Paginates all active Stripe products and upserts each one
// that carries `carrtech_product` metadata. Tiers/prices that disappear from
// Stripe are marked inactive (never deleted — purchase history keeps FKs).
export async function syncStripeCatalog(
  trigger: SyncTrigger = 'manual',
): Promise<SyncResult> {
  const now = new Date()
  const warnings: string[] = []
  const result: SyncResult = {
    productsUpserted: 0,
    tiersUpserted: 0,
    pricesUpserted: 0,
    tiersDeactivated: 0,
    pricesDeactivated: 0,
    warnings,
  }

  const seenProductSlugs = new Set<string>()
  const seenTierStripeIds = new Set<string>()

  for await (const product of stripe().products.list({ active: true, limit: 100 })) {
    const outcome = await syncProductAndPrices(product, warnings, now)
    if (!outcome) continue
    result.tiersUpserted += 1
    result.pricesUpserted += outcome.pricesUpserted
    result.pricesDeactivated += outcome.pricesDeactivated
    seenTierStripeIds.add(product.id)
    const meta = parseMetadata(product, warnings)
    if (meta) seenProductSlugs.add(meta.productSlug)
  }
  result.productsUpserted = seenProductSlugs.size

  // Deactivate tiers whose Stripe product was removed or flagged inactive.
  if (seenTierStripeIds.size > 0) {
    const staleTiers = await db
      .update(productTiers)
      .set({ isActive: false, lastSyncedAt: now, updatedAt: now })
      .where(
        and(
          eq(productTiers.isActive, true),
          notInArray(productTiers.stripeProductId, Array.from(seenTierStripeIds)),
        ),
      )
      .returning({ id: productTiers.id })
    result.tiersDeactivated = staleTiers.length
  }

  await writeSyncLog(trigger, result)
  return result
}

// Webhook-driven sync of a single Stripe product. Identical to full sync for
// that product: fetches the product, upserts it, and re-reads its prices.
export async function syncSingleStripeProduct(
  stripeProductId: string,
  trigger: SyncTrigger = 'webhook',
): Promise<SyncResult> {
  const now = new Date()
  const warnings: string[] = []
  const result: SyncResult = {
    productsUpserted: 0,
    tiersUpserted: 0,
    pricesUpserted: 0,
    tiersDeactivated: 0,
    pricesDeactivated: 0,
    warnings,
  }

  const product = await stripe().products.retrieve(stripeProductId)
  if (!product.active) {
    // Treat inactive product as a soft delete: mark matching tier inactive.
    const tier = await db.query.productTiers.findFirst({
      where: eq(productTiers.stripeProductId, stripeProductId),
    })
    if (tier && tier.isActive) {
      await db
        .update(productTiers)
        .set({ isActive: false, lastSyncedAt: now, updatedAt: now })
        .where(eq(productTiers.id, tier.id))
      result.tiersDeactivated = 1
    }
    await writeSyncLog(trigger, result)
    return result
  }

  const outcome = await syncProductAndPrices(product, warnings, now)
  if (outcome) {
    result.productsUpserted = 1
    result.tiersUpserted = 1
    result.pricesUpserted = outcome.pricesUpserted
    result.pricesDeactivated = outcome.pricesDeactivated
  }

  await writeSyncLog(trigger, result)
  return result
}

// Webhook-driven resync of all prices under a single Stripe product. Called
// from price.* handlers to avoid drift without re-fetching the whole catalog.
export async function syncPricesForStripeProduct(
  stripeProductId: string,
): Promise<void> {
  const tier = await db.query.productTiers.findFirst({
    where: eq(productTiers.stripeProductId, stripeProductId),
  })
  if (!tier) {
    // Price event arrived before its product was synced — trigger a single
    // product sync so the tier row exists before we touch prices.
    await syncSingleStripeProduct(stripeProductId)
    return
  }

  const now = new Date()
  const warnings: string[] = []
  const syncedPriceIds: string[] = []
  for await (const price of stripe().prices.list({ product: stripeProductId, limit: 100 })) {
    if (!price.active) continue
    const id = await upsertPrice(price, tier.id, now, warnings)
    if (id) syncedPriceIds.push(price.id)
  }

  const knownPrices = await db.query.productTierPrices.findMany({
    where: eq(productTierPrices.tierId, tier.id),
  })
  const stalePriceIds = knownPrices
    .filter((p) => p.isActive && !syncedPriceIds.includes(p.stripePriceId))
    .map((p) => p.id)
  if (stalePriceIds.length > 0) {
    await db
      .update(productTierPrices)
      .set({ isActive: false, lastSyncedAt: now, updatedAt: now })
      .where(inArray(productTierPrices.id, stalePriceIds))
  }
}

async function writeSyncLog(trigger: SyncTrigger, result: SyncResult): Promise<void> {
  const row: NewCatalogSyncLog = {
    trigger,
    result,
  }
  await db.insert(catalogSyncLog).values(row)
}
