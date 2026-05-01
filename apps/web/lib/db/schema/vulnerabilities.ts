import { boolean, index, jsonb, pgTable, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations.ts'
import { hosts } from './hosts.ts'
import { softwarePackages } from './software.ts'

export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'none' | 'unknown'
export type VulnerabilityFindingStatus = 'open' | 'resolved'
export type VulnerabilityFindingConfidence = 'confirmed' | 'probable' | 'unsupported'

export const vulnerabilityCves = pgTable('vulnerability_cves', {
  cveId: text('cve_id').primaryKey(),
  title: text('title'),
  description: text('description'),
  severity: text('severity').notNull().default('unknown').$type<VulnerabilitySeverity>(),
  cvssScore: real('cvss_score'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  modifiedAt: timestamp('modified_at', { withTimezone: true }),
  rejected: boolean('rejected').notNull().default(false),
  knownExploited: boolean('known_exploited').notNull().default(false),
  kevDueDate: timestamp('kev_due_date', { withTimezone: true }),
  kevVendorProject: text('kev_vendor_project'),
  kevProduct: text('kev_product'),
  kevRequiredAction: text('kev_required_action'),
  source: text('source'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('vulnerability_cves_severity_idx').on(t.severity),
  index('vulnerability_cves_kev_idx').on(t.knownExploited),
])

export const hostVulnerabilityFindings = pgTable('host_vulnerability_findings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  hostId: text('host_id').notNull().references(() => hosts.id),
  softwarePackageId: text('software_package_id').notNull().references(() => softwarePackages.id),
  cveId: text('cve_id').notNull().references(() => vulnerabilityCves.cveId),
  status: text('status').notNull().default('open').$type<VulnerabilityFindingStatus>(),
  packageName: text('package_name').notNull(),
  installedVersion: text('installed_version').notNull(),
  fixedVersion: text('fixed_version'),
  source: text('source').notNull(),
  severity: text('severity').notNull().default('unknown').$type<VulnerabilitySeverity>(),
  cvssScore: real('cvss_score'),
  knownExploited: boolean('known_exploited').notNull().default(false),
  confidence: text('confidence').notNull().default('confirmed').$type<VulnerabilityFindingConfidence>(),
  matchReason: text('match_reason'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('host_vuln_findings_uniq').on(t.organisationId, t.hostId, t.softwarePackageId, t.cveId),
  index('host_vuln_findings_org_status_idx').on(t.organisationId, t.status, t.severity),
  index('host_vuln_findings_host_status_idx').on(t.hostId, t.status),
  index('host_vuln_findings_cve_idx').on(t.cveId),
  index('host_vuln_findings_confidence_idx').on(t.organisationId, t.status, t.confidence),
])

export type VulnerabilityCve = typeof vulnerabilityCves.$inferSelect
export type HostVulnerabilityFinding = typeof hostVulnerabilityFindings.$inferSelect
