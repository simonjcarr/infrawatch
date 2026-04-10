import { pgTable, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import type { HostCollectionSettings } from './hosts'

export interface OrgMetadata {
  defaultCollectionSettings?: HostCollectionSettings
}

export const organisations = pgTable('organisations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
  licenceTier: text('licence_tier').notNull().default('community'),
  licenceKey: text('licence_key'),
  metricRetentionDays: integer('metric_retention_days').notNull().default(30),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<OrgMetadata>(),
})

export type Organisation = typeof organisations.$inferSelect
export type NewOrganisation = typeof organisations.$inferInsert
