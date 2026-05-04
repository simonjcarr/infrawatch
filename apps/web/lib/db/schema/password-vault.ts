import { createId } from '@paralleldrive/cuid2'
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { organisations } from './organisations.ts'

export const PASSWORD_VAULT_STATUSES = ['active', 'archived'] as const
export type PasswordVaultStatus = (typeof PASSWORD_VAULT_STATUSES)[number]

export const PASSWORD_VAULT_MEMBER_ROLES = ['owner', 'admin', 'member'] as const
export type PasswordVaultMemberRole = (typeof PASSWORD_VAULT_MEMBER_ROLES)[number]

export const PASSWORD_VAULT_ROTATION_REASONS = [
  'initial_setup',
  'membership_change',
  'manual_rotation',
] as const
export type PasswordVaultRotationReason = (typeof PASSWORD_VAULT_ROTATION_REASONS)[number]

export type PasswordVaultEnvelope = Record<string, unknown>
export type PasswordVaultKdfParams = Record<string, unknown>

export const passwordVaultUserKeys = pgTable(
  'password_vault_user_keys',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    publicKey: text('public_key').notNull(),
    encryptedPrivateKeyEnvelope: jsonb('encrypted_private_key_envelope')
      .$type<PasswordVaultEnvelope>()
      .notNull(),
    kdfParams: jsonb('kdf_params').$type<PasswordVaultKdfParams>().notNull(),
    envelopeVersion: text('envelope_version').notNull().default('v1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('password_vault_user_keys_user_uidx').on(t.userId),
  ],
)

export const passwordVaults = pgTable(
  'password_vaults',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    encryptedDisplayEnvelope: jsonb('encrypted_display_envelope')
      .$type<PasswordVaultEnvelope>()
      .notNull(),
    status: text('status').$type<PasswordVaultStatus>().notNull().default('active'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    deletedByUserId: text('deleted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('password_vaults_org_status_idx').on(t.organisationId, t.status),
    index('password_vaults_org_updated_idx').on(t.organisationId, t.updatedAt),
  ],
)

export const passwordVaultKeyEpochs = pgTable(
  'password_vault_key_epochs',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    vaultId: text('vault_id')
      .notNull()
      .references(() => passwordVaults.id, { onDelete: 'cascade' }),
    epochNumber: integer('epoch_number').notNull(),
    wrapVersion: text('wrap_version').notNull().default('v1'),
    rotationReason: text('rotation_reason')
      .$type<PasswordVaultRotationReason>()
      .notNull()
      .default('initial_setup'),
    rotatedByUserId: text('rotated_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('password_vault_key_epochs_vault_epoch_uidx').on(t.vaultId, t.epochNumber),
    index('password_vault_key_epochs_org_vault_idx').on(t.organisationId, t.vaultId),
  ],
)

export const passwordVaultMembers = pgTable(
  'password_vault_members',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    vaultId: text('vault_id')
      .notNull()
      .references(() => passwordVaults.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<PasswordVaultMemberRole>().notNull().default('member'),
    wrappedVaultKeyEnvelope: jsonb('wrapped_vault_key_envelope').$type<PasswordVaultEnvelope>().notNull(),
    keyEpochId: text('key_epoch_id')
      .notNull()
      .references(() => passwordVaultKeyEpochs.id, { onDelete: 'restrict' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: text('revoked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('password_vault_members_vault_user_uidx').on(t.vaultId, t.userId),
    index('password_vault_members_org_vault_idx').on(t.organisationId, t.vaultId),
    index('password_vault_members_user_revoked_idx').on(t.userId, t.revokedAt),
  ],
)

export const passwordVaultEntries = pgTable(
  'password_vault_entries',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    vaultId: text('vault_id')
      .notNull()
      .references(() => passwordVaults.id, { onDelete: 'cascade' }),
    encryptedPayloadEnvelope: jsonb('encrypted_payload_envelope')
      .$type<PasswordVaultEnvelope>()
      .notNull(),
    encryptedDisplayEnvelope: jsonb('encrypted_display_envelope')
      .$type<PasswordVaultEnvelope>()
      .notNull(),
    envelopeVersion: text('envelope_version').notNull().default('v1'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    deletedByUserId: text('deleted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('password_vault_entries_vault_updated_idx').on(t.vaultId, t.updatedAt),
    index('password_vault_entries_org_vault_idx').on(t.organisationId, t.vaultId),
  ],
)

export type PasswordVaultUserKey = typeof passwordVaultUserKeys.$inferSelect
export type NewPasswordVaultUserKey = typeof passwordVaultUserKeys.$inferInsert
export type PasswordVault = typeof passwordVaults.$inferSelect
export type NewPasswordVault = typeof passwordVaults.$inferInsert
export type PasswordVaultKeyEpoch = typeof passwordVaultKeyEpochs.$inferSelect
export type NewPasswordVaultKeyEpoch = typeof passwordVaultKeyEpochs.$inferInsert
export type PasswordVaultMember = typeof passwordVaultMembers.$inferSelect
export type NewPasswordVaultMember = typeof passwordVaultMembers.$inferInsert
export type PasswordVaultEntry = typeof passwordVaultEntries.$inferSelect
export type NewPasswordVaultEntry = typeof passwordVaultEntries.$inferInsert
