import { pgTable, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations.ts'

// Normalised tag catalogue. One row per distinct (org, key, value) — resource
// assignments reference this table via resource_tags.tag_id. The case-insensitive
// unique index prevents near-duplicate spellings ("prod" vs "Prod") from
// coexisting; the UI powers autocomplete off these rows so users are nudged
// toward the canonical entry.
export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tags_org_key_value_ci_uidx').on(
      table.organisationId,
      sql`lower(${table.key})`,
      sql`lower(${table.value})`,
    ),
    index('tags_org_key_idx').on(table.organisationId, table.key),
  ],
)

export type Tag = typeof tags.$inferSelect
export type NewTag = typeof tags.$inferInsert

export interface TagPair {
  key: string
  value: string
}
