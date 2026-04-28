import { pgTable, text, timestamp, integer, bigint, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'

export const ingestServerSnapshots = pgTable('ingest_server_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  serverId: text('server_id').notNull(),
  hostname: text('hostname').notNull(),
  processId: integer('process_id').notNull(),
  version: text('version'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  activeRequests: integer('active_requests').notNull().default(0),
  messagesReceivedTotal: bigint('messages_received_total', { mode: 'number' }).notNull().default(0),
  queueDepth: integer('queue_depth').notNull().default(0),
  queueCapacity: integer('queue_capacity').notNull().default(0),
  goroutines: integer('goroutines').notNull().default(0),
  heapAllocBytes: bigint('heap_alloc_bytes', { mode: 'number' }).notNull().default(0),
  heapSysBytes: bigint('heap_sys_bytes', { mode: 'number' }).notNull().default(0),
  dbOpenConnections: integer('db_open_connections').notNull().default(0),
  dbAcquiredConnections: integer('db_acquired_connections').notNull().default(0),
  gcPauseTotalNs: bigint('gc_pause_total_ns', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ingest_server_snapshots_server_time_idx').on(t.serverId, t.observedAt),
  index('ingest_server_snapshots_observed_idx').on(t.observedAt),
])

export type IngestServerSnapshot = typeof ingestServerSnapshots.$inferSelect
export type NewIngestServerSnapshot = typeof ingestServerSnapshots.$inferInsert
