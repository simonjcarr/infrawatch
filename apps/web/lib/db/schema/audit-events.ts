import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { users } from './auth'

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  actorUserId: text('actor_user_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  summary: text('summary').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('audit_events_org_time_idx').on(t.organisationId, t.createdAt),
  index('audit_events_actor_time_idx').on(t.actorUserId, t.createdAt),
  index('audit_events_target_time_idx').on(t.targetType, t.targetId, t.createdAt),
])

export type AuditEvent = typeof auditEvents.$inferSelect
export type NewAuditEvent = typeof auditEvents.$inferInsert
