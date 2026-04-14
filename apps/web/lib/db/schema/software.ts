import { pgTable, text, timestamp, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { hosts } from './hosts'
import { taskRunHosts } from './task-runs'
import { users } from './auth'

export type PackageSource =
  | 'rpm'
  | 'dpkg'
  | 'pacman'
  | 'apk'
  | 'winreg'
  | 'homebrew'
  | 'snap'
  | 'flatpak'
  | 'macapps'
  | 'other'

/**
 * One row per (org, host, name, version, architecture) combination.
 * Packages are upserted on each scan; rows not seen in the latest scan get
 * `removed_at` stamped instead of being deleted, so `first_seen_at` is stable
 * for "new in last N days" queries.
 */
export const softwarePackages = pgTable(
  'software_packages',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    hostId: text('host_id').notNull().references(() => hosts.id),
    name: text('name').notNull(),
    version: text('version').notNull(),
    architecture: text('architecture'),
    publisher: text('publisher'),
    source: text('source').notNull().$type<PackageSource>(),
    installDate: timestamp('install_date', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    // Set when a later scan no longer reports this package. Cleared on re-appearance.
    removedAt: timestamp('removed_at', { withTimezone: true }),
    // Reserved for a future CVE matcher; always null in v1.
    cveMatches: jsonb('cve_matches'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sw_pkg_uniq').on(t.organisationId, t.hostId, t.name, t.version, t.architecture),
    index('sw_pkg_org_name_idx').on(t.organisationId, t.name),
    index('sw_pkg_host_idx').on(t.hostId),
    index('sw_pkg_first_seen_idx').on(t.organisationId, t.firstSeenAt),
  ],
)

/**
 * One row per scan attempt. Tracks outcome and package-change counts so the UI
 * can show "last scan: 2h ago, +12 -3 packages" without scanning the main table.
 */
export const softwareScans = pgTable(
  'software_scans',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    hostId: text('host_id').notNull().references(() => hosts.id),
    taskRunHostId: text('task_run_host_id').references(() => taskRunHosts.id),
    status: text('status').notNull().$type<'running' | 'success' | 'partial' | 'failed'>(),
    source: text('source').$type<PackageSource>(),
    packageCount: integer('package_count').notNull().default(0),
    addedCount: integer('added_count').notNull().default(0),
    removedCount: integer('removed_count').notNull().default(0),
    unchangedCount: integer('unchanged_count').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sw_scan_host_idx').on(t.hostId, t.createdAt),
    index('sw_scan_org_idx').on(t.organisationId, t.createdAt),
  ],
)

/**
 * User-saved filter sets for the software report page.
 * Filters are stored as validated JSON and re-validated on load.
 */
export const savedSoftwareReports = pgTable(
  'saved_software_reports',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    userId: text('user_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    // The full filter shape serialised as JSON. Validated against the current
    // filter schema on load; invalid/stale saves are silently discarded.
    filters: jsonb('filters').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('saved_sw_reports_user_idx').on(t.userId)],
)

export type SoftwarePackage = typeof softwarePackages.$inferSelect
export type NewSoftwarePackage = typeof softwarePackages.$inferInsert
export type SoftwareScan = typeof softwareScans.$inferSelect
export type NewSoftwareScan = typeof softwareScans.$inferInsert
export type SavedSoftwareReport = typeof savedSoftwareReports.$inferSelect
export type NewSavedSoftwareReport = typeof savedSoftwareReports.$inferInsert
