import { pgTable, text, timestamp, jsonb, boolean, integer, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { hosts } from './hosts'

export interface PortCheckConfig {
  host: string
  port: number
}

export interface ProcessCheckConfig {
  process_name: string
}

export interface HttpCheckConfig {
  url: string
  expected_status: number
}

export interface CertificateCheckConfig {
  host: string
  port: number
  serverName?: string
  timeoutSeconds?: number
}

export type CheckConfig = PortCheckConfig | ProcessCheckConfig | HttpCheckConfig | CertificateCheckConfig

export type CheckType = 'port' | 'process' | 'http' | 'certificate'
export type CheckStatus = 'pass' | 'fail' | 'error'

export const checks = pgTable('checks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  hostId: text('host_id').references(() => hosts.id),
  name: text('name').notNull(),
  checkType: text('check_type').notNull().$type<CheckType>(),
  config: jsonb('config').notNull().$type<CheckConfig>(),
  enabled: boolean('enabled').notNull().default(true),
  intervalSeconds: integer('interval_seconds').notNull().default(60),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (table) => [
  index('checks_org_host_idx').on(table.organisationId, table.hostId),
])

export const checkResults = pgTable('check_results', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  checkId: text('check_id').notNull().references(() => checks.id),
  hostId: text('host_id').notNull().references(() => hosts.id),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().$type<CheckStatus>(),
  output: text('output'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('check_results_check_idx').on(table.checkId, table.ranAt),
  index('check_results_org_idx').on(table.organisationId, table.ranAt),
])

export type Check = typeof checks.$inferSelect
export type NewCheck = typeof checks.$inferInsert
export type CheckResultRow = typeof checkResults.$inferSelect
export type NewCheckResult = typeof checkResults.$inferInsert
