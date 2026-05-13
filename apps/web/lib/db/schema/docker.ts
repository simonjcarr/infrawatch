import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
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

export type DockerContainerLifecycleEventType =
  | 'started'
  | 'stopped'
  | 'restarted'
  | 'disappeared'

export const dockerContainerLifecycleEvents = pgTable(
  'docker_container_lifecycle_events',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    instanceId: text('instance_id')
      .notNull()
      .references(() => instanceSettings.id),
    hostId: text('host_id')
      .notNull()
      .references(() => hosts.id),
    dockerContainerRowId: text('docker_container_row_id')
      .notNull()
      .references(() => dockerContainers.id),
    dockerContainerId: text('docker_container_id').notNull(),
    eventType: text('event_type').notNull().$type<DockerContainerLifecycleEventType>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    primaryName: text('primary_name'),
    image: text('image'),
    state: text('state'),
    status: text('status'),
    restartCount: integer('restart_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('docker_container_lifecycle_events_host_event_uidx').on(t.hostId, t.dockerContainerId, t.eventType, t.occurredAt),
    index('docker_container_lifecycle_events_org_host_time_idx').on(t.instanceId, t.hostId, t.occurredAt),
    index('docker_container_lifecycle_events_org_container_time_idx').on(t.instanceId, t.dockerContainerRowId, t.occurredAt),
  ],
)

export type DockerContainerLifecycleEvent = typeof dockerContainerLifecycleEvents.$inferSelect
export type NewDockerContainerLifecycleEvent = typeof dockerContainerLifecycleEvents.$inferInsert

export const dockerContainerMetrics = pgTable(
  'docker_container_metrics',
  {
    id: text('id').notNull().$defaultFn(() => createId()),
    instanceId: text('instance_id')
      .notNull()
      .references(() => instanceSettings.id),
    hostId: text('host_id')
      .notNull()
      .references(() => hosts.id),
    dockerContainerRowId: text('docker_container_row_id')
      .notNull()
      .references(() => dockerContainers.id),
    dockerContainerId: text('docker_container_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    cpuPercent: doublePrecision('cpu_percent'),
    memoryUsageBytes: bigint('memory_usage_bytes', { mode: 'number' }),
    memoryLimitBytes: bigint('memory_limit_bytes', { mode: 'number' }),
    memoryPercent: doublePrecision('memory_percent'),
    networkRxBytes: bigint('network_rx_bytes', { mode: 'number' }),
    networkTxBytes: bigint('network_tx_bytes', { mode: 'number' }),
    blockReadBytes: bigint('block_read_bytes', { mode: 'number' }),
    blockWriteBytes: bigint('block_write_bytes', { mode: 'number' }),
    pidsCurrent: integer('pids_current'),
    restartCount: integer('restart_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.recordedAt] }),
    index('docker_container_metrics_org_host_time_idx').on(t.instanceId, t.hostId, t.recordedAt),
    index('docker_container_metrics_org_container_time_idx').on(t.instanceId, t.dockerContainerRowId, t.recordedAt),
  ],
)

export type DockerContainerMetric = typeof dockerContainerMetrics.$inferSelect
export type NewDockerContainerMetric = typeof dockerContainerMetrics.$inferInsert

export const dockerTelemetryBatches = pgTable(
  'docker_telemetry_batches',
  {
    instanceId: text('instance_id')
      .notNull()
      .references(() => instanceSettings.id),
    hostId: text('host_id')
      .notNull()
      .references(() => hosts.id),
    agentId: text('agent_id').notNull(),
    batchId: text('batch_id').notNull(),
    sequence: integer('sequence'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    sampleCount: integer('sample_count').notNull().default(0),
    inventoryCount: integer('inventory_count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('docker_telemetry_batches_host_batch_uidx').on(t.hostId, t.batchId),
    index('docker_telemetry_batches_received_idx').on(t.receivedAt),
  ],
)

export type DockerTelemetryBatch = typeof dockerTelemetryBatches.$inferSelect
export type NewDockerTelemetryBatch = typeof dockerTelemetryBatches.$inferInsert
