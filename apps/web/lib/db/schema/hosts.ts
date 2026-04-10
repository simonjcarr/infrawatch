import { pgTable, text, timestamp, jsonb, integer, real } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { agents } from './agents'

export interface DiskInfo {
  mount_point: string
  device: string
  fs_type: string
  total_bytes: number
  used_bytes: number
  free_bytes: number
  percent_used: number
}

export interface NetworkInterface {
  name: string
  ip_addresses: string[]
  mac_address: string
  is_up: boolean
}

export interface HostCollectionSettings {
  cpu: boolean
  memory: boolean
  disk: boolean
  localUsers: boolean
  localUserConfig?: {
    mode: 'all' | 'selected'
    selectedUsernames?: string[]
  }
}

export const DEFAULT_COLLECTION_SETTINGS: HostCollectionSettings = {
  cpu: true,
  memory: true,
  disk: true,
  localUsers: false,
}

export interface HostMetadata {
  disks: DiskInfo[]
  network_interfaces: NetworkInterface[]
  collectionSettings?: HostCollectionSettings
}

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
  metadata: jsonb('metadata').$type<HostMetadata>(),
})

export type Host = typeof hosts.$inferSelect
export type NewHost = typeof hosts.$inferInsert
