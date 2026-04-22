import { pgTable, text, timestamp, real, integer, primaryKey, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { hosts } from './hosts'

export const hostMetrics = pgTable(
  'host_metrics',
  {
    id: text('id').notNull().$defaultFn(() => createId()),
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
  },
  (t) => [
    primaryKey({ columns: [t.id, t.recordedAt] }),
    // Composite index for the most common query pattern: org + host within a time range.
    // Critical for TimescaleDB hypertables — without this every time-series query falls
    // back to a full table scan, which degrades the entire cluster for all tenants.
    index('host_metrics_org_host_time_idx').on(
      t.organisationId,
      t.hostId,
      t.recordedAt,
    ),
  ],
)

export type HostMetric = typeof hostMetrics.$inferSelect
export type NewHostMetric = typeof hostMetrics.$inferInsert
