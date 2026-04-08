import { pgTable, text, timestamp, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { hosts } from './hosts'
import { checks } from './checks'

export interface CertificateChainEntry {
  subject: string
  issuer: string
  notBefore: string      // ISO
  notAfter: string
  fingerprintSha256: string
}

export interface CertificateDetails {
  subject: string
  issuer: string
  serialNumber: string
  signatureAlgorithm: string
  keyAlgorithm: string       // e.g. "RSA-2048"
  isSelfSigned: boolean
  chain: CertificateChainEntry[]
}

export type CertificateStatus = 'valid' | 'expiring_soon' | 'expired' | 'invalid'
export type CertificateSource = 'discovered' | 'imported' | 'issued'
export type CertificateEventType =
  | 'discovered'
  | 'renewed'
  | 'expiring_soon'
  | 'expired'
  | 'restored'
  | 'removed'

export const certificates = pgTable('certificates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  discoveredByHostId: text('discovered_by_host_id').references(() => hosts.id),
  checkId: text('check_id').references(() => checks.id),
  source: text('source').notNull().$type<CertificateSource>().default('discovered'),
  host: text('host').notNull(),              // observed hostname or IP
  port: integer('port').notNull(),
  serverName: text('server_name').notNull(), // SNI used
  commonName: text('common_name').notNull(),
  issuer: text('issuer').notNull(),
  sans: jsonb('sans').notNull().$type<string[]>().default([]),
  notBefore: timestamp('not_before', { withTimezone: true }).notNull(),
  notAfter: timestamp('not_after', { withTimezone: true }).notNull(),
  fingerprintSha256: text('fingerprint_sha256').notNull(),
  status: text('status').notNull().$type<CertificateStatus>().default('valid'),
  details: jsonb('details').notNull().$type<CertificateDetails>(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (t) => [
  uniqueIndex('certificates_identity_idx').on(
    t.organisationId, t.host, t.port, t.serverName, t.fingerprintSha256,
  ),
  index('certificates_org_expiry_idx').on(t.organisationId, t.notAfter),
  index('certificates_org_status_idx').on(t.organisationId, t.status),
  index('certificates_org_host_idx').on(t.organisationId, t.discoveredByHostId),
])

export const certificateEvents = pgTable('certificate_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  certificateId: text('certificate_id').notNull().references(() => certificates.id),
  eventType: text('event_type').notNull().$type<CertificateEventType>(),
  previousStatus: text('previous_status').$type<CertificateStatus>(),
  newStatus: text('new_status').$type<CertificateStatus>(),
  message: text('message').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'),
}, (t) => [
  index('cert_events_cert_time_idx').on(t.certificateId, t.occurredAt),
  index('cert_events_org_time_idx').on(t.organisationId, t.occurredAt),
])

export type Certificate = typeof certificates.$inferSelect
export type NewCertificate = typeof certificates.$inferInsert
export type CertificateEvent = typeof certificateEvents.$inferSelect
export type NewCertificateEvent = typeof certificateEvents.$inferInsert
