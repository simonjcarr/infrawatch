import { pgTable, text, timestamp, jsonb, integer, boolean, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations.ts'
import { users } from './auth.ts'
import type { TaskType, TaskConfig } from './task-runs.ts'

export const taskSchedules = pgTable('task_schedules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  createdBy: text('created_by').references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  taskType: text('task_type').notNull().$type<TaskType>(),
  config: jsonb('config').notNull().$type<TaskConfig>(),
  targetType: text('target_type').notNull().$type<'host' | 'group'>(),
  targetId: text('target_id').notNull(),
  maxParallel: integer('max_parallel').notNull().default(1),
  cronExpression: text('cron_expression').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  lastRunTaskRunId: text('last_run_task_run_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (t) => [
  index('task_schedules_org_idx').on(t.organisationId, t.createdAt),
  index('task_schedules_due_idx').on(t.enabled, t.nextRunAt),
])

export type TaskSchedule = typeof taskSchedules.$inferSelect
export type NewTaskSchedule = typeof taskSchedules.$inferInsert
