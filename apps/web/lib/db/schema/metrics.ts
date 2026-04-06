import { pgTable, text, timestamp, real, integer } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { hosts } from './hosts'

export const hostMetrics = pgTable('host_metrics', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  hostId: text('host_id')
    .notNull()
    .references(() => hosts.id),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  cpuPercent: real('cpu_percent'),
  memoryPercent: real('memory_percent'),
  diskPercent: real('disk_percent'),
  uptimeSeconds: integer('uptime_seconds'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type HostMetric = typeof hostMetrics.$inferSelect
export type NewHostMetric = typeof hostMetrics.$inferInsert
