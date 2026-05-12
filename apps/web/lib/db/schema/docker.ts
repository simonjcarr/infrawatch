import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { instanceSettings } from './instance-settings.ts'
import { hosts } from './hosts.ts'

export type DockerRuntimeStatus =
  | 'not_installed'
  | 'installed'
  | 'permission_denied'
  | 'unreachable'
  | 'error'

export const hostDockerStatus = pgTable(
  'host_docker_status',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    instanceId: text('instance_id')
      .notNull()
      .references(() => instanceSettings.id),
    hostId: text('host_id')
      .notNull()
      .references(() => hosts.id),
    status: text('status').notNull().$type<DockerRuntimeStatus>(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    runtimeVersion: text('runtime_version'),
    apiVersion: text('api_version'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('host_docker_status_host_uidx').on(t.hostId),
    index('host_docker_status_org_status_checked_idx').on(t.instanceId, t.status, t.checkedAt),
  ],
)

export type HostDockerStatus = typeof hostDockerStatus.$inferSelect
export type NewHostDockerStatus = typeof hostDockerStatus.$inferInsert
