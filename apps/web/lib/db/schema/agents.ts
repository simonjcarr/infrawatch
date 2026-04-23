import { pgTable, text, timestamp, jsonb, boolean, integer } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { users } from './auth'

export interface AgentEnrolmentTokenMetadata {
  tags?: Array<{ key: string; value: string }>
  source?: string
  os?: string
  arch?: string
}

export const agentEnrolmentTokens = pgTable('agent_enrolment_tokens', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  label: text('label').notNull(),
  token: text('token').notNull().unique().$defaultFn(() => createId()),
  // SHA-256 hex digest of token. Used for hash-based ingest validation so the
  // plaintext is never compared in cleartext over the DB wire. Nullable for
  // backward compat with tokens created before this column was added.
  tokenHash: text('token_hash').unique(),
  createdById: text('created_by_id')
    .notNull()
    .references(() => users.id),
  autoApprove: boolean('auto_approve').notNull().default(false),
  skipVerify: boolean('skip_verify').notNull().default(false),
  maxUses: integer('max_uses'),
  usageCount: integer('usage_count').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<AgentEnrolmentTokenMetadata>(),
})

export const agents = pgTable('agents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  hostname: text('hostname').notNull(),
  publicKey: text('public_key').notNull().unique(),
  status: text('status')
    .notNull()
    .default('pending')
    .$type<'pending' | 'active' | 'offline' | 'revoked'>(),
  version: text('version'),
  os: text('os'),
  arch: text('arch'),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  approvedById: text('approved_by_id').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  enrolmentTokenId: text('enrolment_token_id').references(() => agentEnrolmentTokens.id),
  // mTLS client cert issued by the internal agent CA. The agent picks up a
  // newly-signed PEM on its next heartbeat and re-dials with mTLS. Serial is
  // unique and is the revocation key.
  clientCertPem: text('client_cert_pem'),
  clientCertSerial: text('client_cert_serial').unique(),
  clientCertIssuedAt: timestamp('client_cert_issued_at', { withTimezone: true }),
  clientCertNotAfter: timestamp('client_cert_not_after', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
})

export const agentStatusHistory = pgTable('agent_status_history', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  status: text('status').notNull().$type<'pending' | 'active' | 'offline' | 'revoked'>(),
  actorId: text('actor_id'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'),
})

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
export type AgentStatusHistory = typeof agentStatusHistory.$inferSelect
export type AgentEnrolmentToken = typeof agentEnrolmentTokens.$inferSelect
export type NewAgentEnrolmentToken = typeof agentEnrolmentTokens.$inferInsert
