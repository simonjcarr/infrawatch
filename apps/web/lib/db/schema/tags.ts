import { pgTable, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { instanceSettings } from './instance-settings.ts'

// Normalised tag catalogue. One row per distinct (org, key, value) — resource
// assignments reference this table via resource_tags.tag_id. The case-insensitive
// unique index prevents near-duplicate spellings ("prod" vs "Prod") from
// coexisting; the UI powers autocomplete off these rows so users are nudged
// toward the canonical entry.
export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    instanceId: text('instance_id')
      .notNull()
      .references(() => instanceSettings.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tags_org_key_value_ci_uidx').on(
      table.instanceId,
      sql`lower(${table.key})`,
      sql`lower(${table.value})`,
    ),
    index('tags_org_key_idx').on(table.instanceId, table.key),
  ],
)

export type Tag = typeof tags.$inferSelect
export type NewTag = typeof tags.$inferInsert

export interface TagPair {
  key: string
  value: string
}
