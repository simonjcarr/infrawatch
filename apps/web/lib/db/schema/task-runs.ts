import { pgTable, text, timestamp, jsonb, integer, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { hosts } from './hosts'
import { users } from './auth'

export type TaskType = 'patch' | 'custom_script' | 'service' | 'agent_uninstall' | 'software_inventory'
export type TaskRunStatus = 'pending' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
export type TaskRunHostStatus = 'pending' | 'running' | 'cancelling' | 'cancelled' | 'success' | 'failed' | 'skipped'

// Config shapes — discriminated by task_type
export interface PatchTaskConfig { mode: 'security' | 'all' }
export interface CustomScriptTaskConfig {
  script: string
  interpreter: 'sh' | 'bash' | 'python3'
  timeout_seconds?: number
}
export interface ServiceTaskConfig {
  service_name: string
  action: 'start' | 'stop' | 'restart' | 'status'
}
// agent_uninstall carries no parameters today; reserved for future flags.
export type AgentUninstallTaskConfig = Record<string, never>
// software_inventory carries no config; OS detection is on-agent.
export type SoftwareInventoryTaskConfig = Record<string, never>
export type TaskConfig = PatchTaskConfig | CustomScriptTaskConfig | ServiceTaskConfig | AgentUninstallTaskConfig | SoftwareInventoryTaskConfig

// Result shapes
export interface PackageUpdate {
  name: string
  from_version: string
  to_version: string
}
export interface PatchTaskResult {
  packages_updated: PackageUpdate[]
  reboot_required: boolean
}
export interface CustomScriptTaskResult {
  exit_code: number
}
export interface ServiceTaskResult {
  service_name: string
  action: string
  is_active: boolean
}
// Agent reports "scheduled" once it has handed off to a detached uninstaller process.
export interface AgentUninstallTaskResult {
  status: 'scheduled'
  note?: string
}
// software_inventory result carries only counts; the package list is submitted
// via the dedicated SubmitSoftwareInventory gRPC stream.
export interface SoftwareInventoryTaskResult {
  scan_id: string
  package_count: number
  source: string
  started_at: string
  completed_at: string
}
export type TaskResult = PatchTaskResult | CustomScriptTaskResult | ServiceTaskResult | AgentUninstallTaskResult | SoftwareInventoryTaskResult

export const taskRuns = pgTable('task_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  // NULL when created by the system sweeper (e.g. automated software inventory scans).
  triggeredBy: text('triggered_by').references(() => users.id),
  targetType: text('target_type').notNull().$type<'host' | 'group'>(),
  targetId: text('target_id').notNull(),
  taskType: text('task_type').notNull().$type<TaskType>(),
  config: jsonb('config').notNull().$type<TaskConfig>(),
  maxParallel: integer('max_parallel').notNull().default(1), // 0 = unlimited
  status: text('status').notNull().default('pending').$type<TaskRunStatus>(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (t) => [
  index('task_runs_org_idx').on(t.organisationId, t.createdAt),
  index('task_runs_target_idx').on(t.targetType, t.targetId),
])

export const taskRunHosts = pgTable('task_run_hosts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  taskRunId: text('task_run_id').notNull().references(() => taskRuns.id),
  hostId: text('host_id').notNull().references(() => hosts.id),
  status: text('status').notNull().default('pending').$type<TaskRunHostStatus>(),
  skipReason: text('skip_reason'),
  exitCode: integer('exit_code'),
  rawOutput: text('raw_output').notNull().default(''), // appended incrementally as chunks arrive
  result: jsonb('result').$type<TaskResult>(),          // structured on completion
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (t) => [
  index('task_run_hosts_run_idx').on(t.taskRunId),
  index('task_run_hosts_host_status_idx').on(t.hostId, t.status),
])

export type TaskRun = typeof taskRuns.$inferSelect
export type NewTaskRun = typeof taskRuns.$inferInsert
export type TaskRunHost = typeof taskRunHosts.$inferSelect
export type NewTaskRunHost = typeof taskRunHosts.$inferInsert
