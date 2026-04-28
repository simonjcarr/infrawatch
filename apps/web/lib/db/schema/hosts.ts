import { pgTable, text, timestamp, jsonb, integer, real } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { z } from 'zod'
import { organisations } from './organisations.ts'
import { agents } from './agents.ts'

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

const diskInfoSchema = z.object({
  mount_point: z.string(),
  device: z.string(),
  fs_type: z.string(),
  total_bytes: z.number(),
  used_bytes: z.number(),
  free_bytes: z.number(),
  percent_used: z.number(),
}).strip()

const networkInterfaceSchema = z.object({
  name: z.string(),
  ip_addresses: z.array(z.string()).catch([]),
  mac_address: z.string(),
  is_up: z.boolean(),
}).strip()

const tagPairSchema = z.object({
  key: z.string(),
  value: z.string(),
}).strip()

export const hostCollectionSettingsSchema = z.object({
  cpu: z.boolean().catch(DEFAULT_COLLECTION_SETTINGS.cpu),
  memory: z.boolean().catch(DEFAULT_COLLECTION_SETTINGS.memory),
  disk: z.boolean().catch(DEFAULT_COLLECTION_SETTINGS.disk),
  localUsers: z.boolean().catch(DEFAULT_COLLECTION_SETTINGS.localUsers),
  localUserConfig: z.object({
    mode: z.enum(['all', 'selected']).catch('all'),
    selectedUsernames: z.array(z.string()).catch([]).optional(),
  }).strip().optional().catch(undefined),
}).strip()

export const hostMetadataSchema = z.object({
  disks: z.array(diskInfoSchema).catch([]).default([]),
  network_interfaces: z.array(networkInterfaceSchema).catch([]).default([]),
  collectionSettings: hostCollectionSettingsSchema.optional().catch(undefined),
  terminalEnabled: z.boolean().optional().catch(undefined),
  terminalAllowedUsers: z.array(z.string()).catch([]).optional(),
  sshHostKeySha256: z.string().optional().catch(undefined),
  lastSoftwareScanAt: z.string().optional().catch(undefined),
  pendingTags: z.array(tagPairSchema).catch([]).optional(),
}).strip()

const defaultHostMetadata: HostMetadata = {
  disks: [],
  network_interfaces: [],
}

export function parseHostMetadata(input: unknown): HostMetadata {
  const parsed = hostMetadataSchema.safeParse(input)
  if (!parsed.success) {
    return { ...defaultHostMetadata }
  }
  return parsed.data
}

// Operational thresholds shared between host stats queries (server) and the
// host inventory UI (client). Bumping these means the "hot" resource cards and
// the SQL filter that counts them stay in agreement.
export const HOST_HIGH_USAGE_THRESHOLD = 80
export const HOST_STALE_MINUTES = 15

export interface HostMetadata {
  disks: DiskInfo[]
  network_interfaces: NetworkInterface[]
  collectionSettings?: HostCollectionSettings
  terminalEnabled?: boolean
  terminalAllowedUsers?: string[]
  sshHostKeySha256?: string
  lastSoftwareScanAt?: string    // ISO timestamp; avoid Date in JSONB (use .toISOString())
  // Tags supplied via the agent CLI --tag flag / token metadata at register
  // time. Stashed here until approveAgent merges them with org defaults and
  // writes canonical rows into resource_tags.
  pendingTags?: Array<{ key: string; value: string }>
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
