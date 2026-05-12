import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
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

export const dockerContainers = pgTable(
  'docker_containers',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    instanceId: text('instance_id')
      .notNull()
      .references(() => instanceSettings.id),
    hostId: text('host_id')
      .notNull()
      .references(() => hosts.id),
    dockerContainerId: text('docker_container_id').notNull(),
    primaryName: text('primary_name'),
    namesJson: jsonb('names_json').notNull().$type<string[]>(),
    image: text('image'),
    imageId: text('image_id'),
    labelsJson: jsonb('labels_json').notNull().$type<Record<string, string>>(),
    state: text('state'),
    status: text('status'),
    createdAtSource: timestamp('created_at_source', { withTimezone: true }),
    startedAtSource: timestamp('started_at_source', { withTimezone: true }),
    finishedAtSource: timestamp('finished_at_source', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    lastInventoryAt: timestamp('last_inventory_at', { withTimezone: true }).notNull(),
    restartCount: integer('restart_count'),
    isPresent: boolean('is_present').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('docker_containers_host_container_uidx').on(t.hostId, t.dockerContainerId),
    index('docker_containers_org_host_present_seen_idx').on(t.instanceId, t.hostId, t.isPresent, t.lastSeenAt),
    index('docker_containers_org_image_idx').on(t.instanceId, t.image),
  ],
)

export type DockerContainer = typeof dockerContainers.$inferSelect
export type NewDockerContainer = typeof dockerContainers.$inferInsert
