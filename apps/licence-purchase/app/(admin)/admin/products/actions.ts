'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { products, productTiers, productTierPrices } from '@/lib/db/schema'
import { assertSuperAdmin } from '@/lib/auth/require-super-admin'
import { syncStripeCatalog, type SyncResult } from '@/lib/stripe/sync-catalog'

const productIdSchema = z.object({ productId: z.string().min(1) })
const productActiveSchema = productIdSchema.extend({ isActive: z.boolean() })
const productDescSchema = productIdSchema.extend({ description: z.string().max(2000) })
const productOrderSchema = productIdSchema.extend({ displayOrder: z.number().int() })
const tierActiveSchema = z.object({ tierId: z.string().min(1), isActive: z.boolean() })
const priceActiveSchema = z.object({ priceId: z.string().min(1), isActive: z.boolean() })

function invalidateAdmin(productId?: string) {
  revalidatePath('/admin/products')
  if (productId) revalidatePath(`/admin/products/${productId}`)
  revalidatePath('/products')
}

export async function toggleProductActive(input: unknown): Promise<void> {
  await assertSuperAdmin()
  const { productId, isActive } = productActiveSchema.parse(input)
  await db
    .update(products)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(products.id, productId))
  invalidateAdmin(productId)
}

export async function updateProductDescription(input: unknown): Promise<void> {
  await assertSuperAdmin()
  const { productId, description } = productDescSchema.parse(input)
  await db
    .update(products)
    .set({ description: description.trim() || null, updatedAt: new Date() })
    .where(eq(products.id, productId))
  invalidateAdmin(productId)
}

export async function updateProductDisplayOrder(input: unknown): Promise<void> {
  await assertSuperAdmin()
  const { productId, displayOrder } = productOrderSchema.parse(input)
  await db
    .update(products)
    .set({ displayOrder, updatedAt: new Date() })
    .where(eq(products.id, productId))
  invalidateAdmin(productId)
}

export async function toggleTierActive(input: unknown): Promise<void> {
  await assertSuperAdmin()
  const { tierId, isActive } = tierActiveSchema.parse(input)
  await db
    .update(productTiers)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(productTiers.id, tierId))
  const tier = await db.query.productTiers.findFirst({ where: eq(productTiers.id, tierId) })
  invalidateAdmin(tier?.productId)
}

export async function togglePriceActive(input: unknown): Promise<void> {
  await assertSuperAdmin()
  const { priceId, isActive } = priceActiveSchema.parse(input)
  await db
    .update(productTierPrices)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(productTierPrices.id, priceId))
  const price = await db.query.productTierPrices.findFirst({
    where: eq(productTierPrices.id, priceId),
  })
  const tier = price
    ? await db.query.productTiers.findFirst({ where: eq(productTiers.id, price.tierId) })
    : null
  invalidateAdmin(tier?.productId)
}

export async function resyncFromStripe(): Promise<SyncResult> {
  await assertSuperAdmin()
  const result = await syncStripeCatalog('manual')
  invalidateAdmin()
  return result
}
