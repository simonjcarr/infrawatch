import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations.ts'
import { tags } from './tags.ts'

export const resourceTags = pgTable(
  'resource_tags',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id),
    resourceId: text('resource_id').notNull(),
    resourceType: text('resource_type').notNull(),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('resource_tags_resource_idx').on(table.resourceId, table.resourceType),
    index('resource_tags_tag_idx').on(table.tagId),
    uniqueIndex('resource_tags_unique_uidx').on(
      table.resourceId,
      table.resourceType,
      table.tagId,
    ),
  ],
)

export type ResourceTag = typeof resourceTags.$inferSelect
export type NewResourceTag = typeof resourceTags.$inferInsert
