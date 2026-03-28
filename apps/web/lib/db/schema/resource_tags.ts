import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'

export const resourceTags = pgTable(
  'resource_tags',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id),
    resourceId: text('resource_id').notNull(),
    resourceType: text('resource_type').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('resource_tags_resource_idx').on(table.resourceId, table.resourceType),
    index('resource_tags_org_kv_idx').on(table.organisationId, table.key, table.value),
  ],
)

export type ResourceTag = typeof resourceTags.$inferSelect
export type NewResourceTag = typeof resourceTags.$inferInsert
