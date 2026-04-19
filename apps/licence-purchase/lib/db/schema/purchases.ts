import { pgTable, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { products, productTiers, productTierPrices } from './products'

// A subscription purchase. One row per Stripe subscription.
export const purchases = pgTable('purchase', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  // Catalog FKs — populated from Stripe session metadata. Nullable so legacy
  // rows keep resolving; a backfill script fills them in after first sync.
  productId: text('product_id').references(() => products.id),
  productTierId: text('product_tier_id').references(() => productTiers.id),
  productTierPriceId: text('product_tier_price_id').references(() => productTierPrices.id),
  // Identity of the customer's Infrawatch install, captured from the activation
  // token the customer pastes into checkout. Used as the JWT `sub` so the
  // minted licence can only be activated on that specific install.
  installOrganisationId: text('install_organisation_id'),
  installOrganisationName: text('install_organisation_name'),
  activationNonce: text('activation_nonce'),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  // Denormalised snapshot from the catalog at purchase time. Retained so
  // operator queries on `tier`/`interval` keep working and so a purchase row
  // still tells a story if a Stripe product is later removed.
  tier: text('tier').notNull(),
  interval: text('interval').notNull(), // 'month' | 'year'
  status: text('status').notNull().default('pending'),
  // status values: 'pending' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired'
  paymentMethod: text('payment_method').notNull(), // 'card' | 'bacs_debit' | 'invoice'
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAt: timestamp('cancel_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'),
})

export const invoices = pgTable('invoice', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  purchaseId: text('purchase_id')
    .notNull()
    .references(() => purchases.id, { onDelete: 'cascade' }),
  stripeInvoiceId: text('stripe_invoice_id').notNull().unique(),
  number: text('number'),
  amountDue: integer('amount_due').notNull(), // in smallest currency unit
  amountPaid: integer('amount_paid').notNull().default(0),
  currency: text('currency').notNull(),
  status: text('status').notNull(), // 'draft' | 'open' | 'paid' | 'uncollectible' | 'void'
  hostedInvoiceUrl: text('hosted_invoice_url'),
  pdfUrl: text('pdf_url'),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Purchase = typeof purchases.$inferSelect
export type NewPurchase = typeof purchases.$inferInsert
export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
