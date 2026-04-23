import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'

export type CaPurpose = 'agent_ca'
export type CaSource = 'auto' | 'byo'

/**
 * Certificate authorities managed by ct-ops.
 *
 * Today there is exactly one row: purpose='agent_ca' with organisationId=NULL
 * (install-wide). The private key PEM is AES-256-GCM encrypted using the same
 * scheme as apps/web/lib/crypto/encrypt.ts.
 *
 * When rotating, the old CA row is soft-deleted via deletedAt but kept in the
 * ingest ClientCAs pool until every leaf cert signed by it has expired — the
 * UI surfaces the overlap window based on the old CA's latest leaf expiry.
 */
export const certificateAuthorities = pgTable('certificate_authorities', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').references(() => organisations.id),
  purpose: text('purpose').notNull().$type<CaPurpose>(),
  certPem: text('cert_pem').notNull(),
  keyPemEncrypted: text('key_pem_encrypted').notNull(),
  source: text('source').notNull().$type<CaSource>(),
  fingerprintSha256: text('fingerprint_sha256').notNull().unique(),
  notBefore: timestamp('not_before', { withTimezone: true }).notNull(),
  notAfter: timestamp('not_after', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (t) => [
  index('cert_authorities_purpose_idx').on(t.purpose, t.deletedAt),
])

export type CertificateAuthority = typeof certificateAuthorities.$inferSelect
export type NewCertificateAuthority = typeof certificateAuthorities.$inferInsert
