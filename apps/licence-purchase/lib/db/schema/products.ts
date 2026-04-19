import { pgTable, text, timestamp, integer, boolean, jsonb, uniqueIndex, index, customType } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { sql } from 'drizzle-orm'

const tsvector = customType<{ data: string; notNull: false; default: false }>({
  dataType() {
    return 'tsvector'
  },
})

// Parent CarrTech.dev product (e.g. CT-Ops, CT-Insights). Product metadata on
// Stripe uses `carrtech_product` as the slug; sync groups Stripe Products into
// this row. Admin owns `description`, `displayOrder`, `isActive` — the sync
// job must not overwrite them.
export const products = pgTable(
  'product',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    stripeMetadataName: text('stripe_metadata_name'),
    isActive: boolean('is_active').notNull().default(true),
    displayOrder: integer('display_order').notNull().default(0),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))`,
    ),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('idx_product_slug').on(t.slug),
    index('idx_product_active_order').on(t.isActive, t.displayOrder),
    index('idx_product_search').using('gin', t.searchTsv),
  ],
)

// A purchasable tier of a product. 1 Stripe Product = 1 tier row. Stripe
// product metadata supplies tier_slug, tier_order, features (JSON array).
export const productTiers = pgTable(
  'product_tier',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    stripeProductId: text('stripe_product_id').notNull(),
    tierSlug: text('tier_slug').notNull(),
    name: text('name').notNull(),
    tierOrder: integer('tier_order').notNull().default(0),
    features: jsonb('features').notNull().$type<string[]>().default(sql`'[]'::jsonb`),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('idx_product_tier_stripe_product_id').on(t.stripeProductId),
    uniqueIndex('idx_product_tier_slug').on(t.productId, t.tierSlug),
    index('idx_product_tier_product_id').on(t.productId),
  ],
)

// One row per Stripe Price (interval). Sync keeps unit_amount + currency fresh
// so the product detail page does not need to call Stripe at render time.
export const productTierPrices = pgTable(
  'product_tier_price',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    tierId: text('tier_id')
      .notNull()
      .references(() => productTiers.id, { onDelete: 'cascade' }),
    stripePriceId: text('stripe_price_id').notNull(),
    interval: text('interval').notNull(), // 'month' | 'year'
    currency: text('currency').notNull(),
    unitAmount: integer('unit_amount').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('idx_product_tier_price_stripe_price_id').on(t.stripePriceId),
    uniqueIndex('idx_product_tier_price_tier_interval_currency').on(
      t.tierId,
      t.interval,
      t.currency,
    ),
    index('idx_product_tier_price_tier_id').on(t.tierId),
  ],
)

export type Product = typeof products.$inferSelect
export type NewProduct = typeof products.$inferInsert
export type ProductTier = typeof productTiers.$inferSelect
export type NewProductTier = typeof productTiers.$inferInsert
export type ProductTierPrice = typeof productTierPrices.$inferSelect
export type NewProductTierPrice = typeof productTierPrices.$inferInsert
