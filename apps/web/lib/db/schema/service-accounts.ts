import { pgTable, text, timestamp, jsonb, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations.ts'
import { hosts } from './hosts.ts'

export type ServiceAccountStatus = 'active' | 'missing' | 'disabled'
export type ServiceAccountType = 'human' | 'service' | 'system'
export type SshKeyType = 'rsa' | 'ed25519' | 'ecdsa' | 'dsa' | 'unknown'
export type SshKeySource = 'authorized_keys' | 'identity'
export type SshKeyStatus = 'active' | 'missing'
export type IdentityEventType =
  | 'account_discovered'
  | 'account_changed'
  | 'account_missing'
  | 'account_restored'
  | 'key_discovered'
  | 'key_missing'
  | 'key_restored'

export const serviceAccounts = pgTable('service_accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  hostId: text('host_id').notNull().references(() => hosts.id),
  username: text('username').notNull(),
  uid: integer('uid'),
  gid: integer('gid'),
  homeDirectory: text('home_directory'),
  shell: text('shell'),
  accountType: text('account_type').notNull().$type<ServiceAccountType>().default('service'),
  hasLoginCapability: boolean('has_login_capability').notNull().default(false),
  hasRunningProcesses: boolean('has_running_processes').notNull().default(false),
  accountLocked: boolean('account_locked').notNull().default(false),
  passwordExpiresAt: timestamp('password_expires_at', { withTimezone: true }),
  passwordLastChangedAt: timestamp('password_last_changed_at', { withTimezone: true }),
  status: text('status').notNull().$type<ServiceAccountStatus>().default('active'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (t) => [
  uniqueIndex('service_accounts_identity_idx').on(t.organisationId, t.hostId, t.username),
  index('service_accounts_org_type_idx').on(t.organisationId, t.accountType),
  index('service_accounts_org_status_idx').on(t.organisationId, t.status),
  index('service_accounts_org_host_idx').on(t.organisationId, t.hostId),
])

export const sshKeys = pgTable('ssh_keys', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  hostId: text('host_id').notNull().references(() => hosts.id),
  serviceAccountId: text('service_account_id').references(() => serviceAccounts.id),
  keyType: text('key_type').notNull().$type<SshKeyType>().default('unknown'),
  bitLength: integer('bit_length'),
  fingerprintSha256: text('fingerprint_sha256').notNull(),
  comment: text('comment'),
  filePath: text('file_path').notNull(),
  keySource: text('key_source').notNull().$type<SshKeySource>().default('authorized_keys'),
  associatedUsername: text('associated_username'),
  status: text('status').notNull().$type<SshKeyStatus>().default('active'),
  keyAgeSeconds: integer('key_age_seconds'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (t) => [
  uniqueIndex('ssh_keys_identity_idx').on(t.organisationId, t.hostId, t.fingerprintSha256, t.filePath),
  index('ssh_keys_org_fingerprint_idx').on(t.organisationId, t.fingerprintSha256),
  index('ssh_keys_org_type_idx').on(t.organisationId, t.keyType),
  index('ssh_keys_org_status_idx').on(t.organisationId, t.status),
  index('ssh_keys_org_host_idx').on(t.organisationId, t.hostId),
  index('ssh_keys_account_idx').on(t.serviceAccountId),
])

export const identityEvents = pgTable('identity_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  serviceAccountId: text('service_account_id').references(() => serviceAccounts.id),
  sshKeyId: text('ssh_key_id').references(() => sshKeys.id),
  hostId: text('host_id').notNull().references(() => hosts.id),
  eventType: text('event_type').notNull().$type<IdentityEventType>(),
  message: text('message').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'),
}, (t) => [
  index('identity_events_org_time_idx').on(t.organisationId, t.occurredAt),
  index('identity_events_account_time_idx').on(t.serviceAccountId, t.occurredAt),
  index('identity_events_key_time_idx').on(t.sshKeyId, t.occurredAt),
  index('identity_events_host_time_idx').on(t.hostId, t.occurredAt),
])

export type ServiceAccount = typeof serviceAccounts.$inferSelect
export type NewServiceAccount = typeof serviceAccounts.$inferInsert
export type SshKey = typeof sshKeys.$inferSelect
export type NewSshKey = typeof sshKeys.$inferInsert
export type IdentityEvent = typeof identityEvents.$inferSelect
export type NewIdentityEvent = typeof identityEvents.$inferInsert
