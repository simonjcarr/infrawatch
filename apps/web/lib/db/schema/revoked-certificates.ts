import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'

/**
 * Serials of revoked agent client certificates.
 *
 * The ingest service loads this set on boot and reloads it periodically (plus
 * a LISTEN/NOTIFY nudge on mutation). VerifyPeerCertificate rejects any
 * handshake whose leaf serial appears here.
 */
export const revokedCertificates = pgTable('revoked_certificates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  serial: text('serial').notNull().unique(),
  reason: text('reason'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('revoked_certs_org_idx').on(t.organisationId),
])

export type RevokedCertificate = typeof revokedCertificates.$inferSelect
export type NewRevokedCertificate = typeof revokedCertificates.$inferInsert
