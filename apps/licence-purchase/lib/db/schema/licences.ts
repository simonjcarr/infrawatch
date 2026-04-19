import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { purchases } from './purchases'
import { products, productTiers } from './products'

// A licence record. The signed JWT lives in `signedJwt`.
// The jti, tier, features and expiresAt columns mirror the JWT claims so we
// can query them without re-parsing the token.
export const licences = pgTable('licence', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  jti: text('jti').notNull().unique(),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  purchaseId: text('purchase_id').references(() => purchases.id),
  // Catalog FKs. Nullable for legacy rows (backfill script fills them in).
  productId: text('product_id').references(() => products.id),
  productTierId: text('product_tier_id').references(() => productTiers.id),
  tier: text('tier').notNull(),
  features: jsonb('features').notNull().$type<string[]>(),
  signedJwt: text('signed_jwt').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Licence = typeof licences.$inferSelect
export type NewLicence = typeof licences.$inferInsert
