import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations.ts'
import { hosts } from './hosts.ts'
import { checks } from './checks.ts'

export type PatchHealthStatus = 'pass' | 'fail' | 'error' | 'unknown'
export type PackageUpdateStatus = 'current' | 'resolved'

export const hostPatchStatuses = pgTable(
  'host_patch_statuses',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    hostId: text('host_id').notNull().references(() => hosts.id),
    checkId: text('check_id').references(() => checks.id),
    status: text('status').notNull().$type<PatchHealthStatus>(),
    lastPatchedAt: timestamp('last_patched_at', { withTimezone: true }),
    patchAgeDays: integer('patch_age_days'),
    maxAgeDays: integer('max_age_days').notNull().default(30),
    packageManager: text('package_manager'),
    updatesSupported: boolean('updates_supported').notNull().default(false),
    updatesCount: integer('updates_count').notNull().default(0),
    updatesTruncated: boolean('updates_truncated').notNull().default(false),
    warnings: jsonb('warnings').$type<string[]>(),
    error: text('error'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('host_patch_statuses_check_uniq').on(t.checkId),
    index('host_patch_statuses_org_status_idx').on(t.organisationId, t.status),
    index('host_patch_statuses_host_checked_idx').on(t.hostId, t.checkedAt),
  ],
)

export const hostPackageUpdates = pgTable(
  'host_package_updates',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    hostId: text('host_id').notNull().references(() => hosts.id),
    name: text('name').notNull(),
    currentVersion: text('current_version'),
    availableVersion: text('available_version'),
    architecture: text('architecture'),
    repository: text('repository'),
    packageManager: text('package_manager'),
    status: text('status').notNull().default('current').$type<PackageUpdateStatus>(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('host_package_updates_current_uniq').on(
      t.organisationId,
      t.hostId,
      t.name,
      t.currentVersion,
      t.availableVersion,
      t.architecture,
      t.packageManager,
    ),
    index('host_package_updates_org_status_idx').on(t.organisationId, t.status),
    index('host_package_updates_host_status_idx').on(t.hostId, t.status),
  ],
)

export type HostPatchStatus = typeof hostPatchStatuses.$inferSelect
export type NewHostPatchStatus = typeof hostPatchStatuses.$inferInsert
export type HostPackageUpdate = typeof hostPackageUpdates.$inferSelect
export type NewHostPackageUpdate = typeof hostPackageUpdates.$inferInsert
