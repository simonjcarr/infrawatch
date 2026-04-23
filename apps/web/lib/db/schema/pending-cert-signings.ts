import { pgTable, text, timestamp, customType, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { agents } from './agents'

// drizzle's built-in bytea helper renders as `customType` for BYTEA columns.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() { return 'bytea' },
})

/**
 * Queue of CSRs awaiting signing by the ingest service.
 *
 * The web app writes a row here when an admin approves an agent (or when the
 * agent requests a renewal through a JWT-authed RPC that the web app proxies
 * — though in practice renewal goes direct to ingest). An ingest sweeper
 * picks rows up, signs with the agent CA, writes the resulting PEM/serial
 * onto the agents row, and deletes this row.
 */
export const pendingCertSignings = pgTable('pending_cert_signings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  agentId: text('agent_id').notNull().references(() => agents.id),
  csrDer: bytea('csr_der').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  // Populated only if signing fails — last error observed by the sweeper.
  lastError: text('last_error'),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
}, (t) => [
  index('pending_cert_signings_requested_at_idx').on(t.requestedAt),
])

export type PendingCertSigning = typeof pendingCertSignings.$inferSelect
export type NewPendingCertSigning = typeof pendingCertSignings.$inferInsert
