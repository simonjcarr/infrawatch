import { pgTable, text, timestamp, real, integer, primaryKey, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { instanceSettings } from './instance-settings.ts'
import { hosts } from './hosts.ts'

export const hostMetrics = pgTable(
  'host_metrics',
  {
    id: text('id').notNull().$defaultFn(() => createId()),
    instanceId: text('instance_id')
      .notNull()
      .references(() => instanceSettings.id),
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
    // Composite index for the most common query pattern: instance + host within a time range.
    // Critical for TimescaleDB hypertables — without this every time-series query falls
    // back to a full table scan, which degrades the entire cluster for all instances.
    index('host_metrics_instance_host_time_idx').on(
      t.instanceId,
      t.hostId,
      t.recordedAt,
    ),
  ],
)

export type HostMetric = typeof hostMetrics.$inferSelect
export type NewHostMetric = typeof hostMetrics.$inferInsert
