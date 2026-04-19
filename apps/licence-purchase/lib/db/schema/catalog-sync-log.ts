import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'

// One row per Stripe catalog sync run. The admin UI reads the latest row to
// show the last sync summary and surface warnings.
export const catalogSyncLog = pgTable('catalog_sync_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  trigger: text('trigger').notNull(), // 'manual' | 'webhook' | 'cli'
  result: jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type CatalogSyncLog = typeof catalogSyncLog.$inferSelect
export type NewCatalogSyncLog = typeof catalogSyncLog.$inferInsert
