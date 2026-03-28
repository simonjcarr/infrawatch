import { pgTable, text, timestamp, jsonb, integer, real } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { agents } from './agents'

export const hosts = pgTable('hosts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  agentId: text('agent_id').references(() => agents.id),
  hostname: text('hostname').notNull(),
  displayName: text('display_name'),
  os: text('os'),
  osVersion: text('os_version'),
  arch: text('arch'),
  ipAddresses: jsonb('ip_addresses').$type<string[]>(),
  cpuPercent: real('cpu_percent'),
  memoryPercent: real('memory_percent'),
  diskPercent: real('disk_percent'),
  uptimeSeconds: integer('uptime_seconds'),
  status: text('status')
    .notNull()
    .default('unknown')
    .$type<'online' | 'offline' | 'unknown'>(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
})

export type Host = typeof hosts.$inferSelect
export type NewHost = typeof hosts.$inferInsert
