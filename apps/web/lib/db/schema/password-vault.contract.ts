export const PASSWORD_VAULT_SECRET_FIELDS = [
  'vault_name',
  'entry_title',
  'username',
  'password',
  'url',
  'notes',
  'totp_seed',
  'tags',
  'folders',
  'custom_fields',
  'unlock_password',
  'derived_unlock_key',
  'vault_key',
  'entry_key',
  'private_key',
] as const

export const PASSWORD_VAULT_TABLE_CONTRACT = {
  userKeys: {
    tableName: 'password_vault_user_keys',
    organisationScoped: false,
    requiredColumns: [
      'id',
      'userId',
      'publicKey',
      'encryptedPrivateKeyEnvelope',
      'kdfParams',
      'envelopeVersion',
      'createdAt',
      'updatedAt',
      'setupCompletedAt',
    ],
    foreignKeys: [
      { column: 'userId', references: 'users.id', onDelete: 'cascade' },
    ],
    uniqueKeys: [
      ['userId'],
    ],
  },
  vaults: {
    tableName: 'password_vaults',
    organisationScoped: true,
    requiredColumns: [
      'id',
      'organisationId',
      'encryptedDisplayEnvelope',
      'status',
      'createdByUserId',
      'updatedByUserId',
      'deletedByUserId',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    foreignKeys: [
      { column: 'organisationId', references: 'organisations.id', onDelete: 'cascade' },
      { column: 'createdByUserId', references: 'users.id', onDelete: 'restrict' },
      { column: 'updatedByUserId', references: 'users.id', onDelete: 'restrict' },
      { column: 'deletedByUserId', references: 'users.id', onDelete: 'set null' },
    ],
  },
  keyEpochs: {
    tableName: 'password_vault_key_epochs',
    organisationScoped: true,
    requiredColumns: [
      'id',
      'organisationId',
      'vaultId',
      'epochNumber',
      'wrapVersion',
      'rotationReason',
      'idempotencyKey',
      'rotatedByUserId',
      'createdAt',
    ],
    foreignKeys: [
      { column: 'organisationId', references: 'organisations.id', onDelete: 'cascade' },
      { column: 'vaultId', references: 'password_vaults.id', onDelete: 'cascade' },
      { column: 'rotatedByUserId', references: 'users.id', onDelete: 'restrict' },
    ],
    uniqueKeys: [
      ['vaultId', 'epochNumber'],
      ['vaultId', 'idempotencyKey'],
    ],
  },
  members: {
    tableName: 'password_vault_members',
    organisationScoped: true,
    requiredColumns: [
      'id',
      'organisationId',
      'vaultId',
      'userId',
      'role',
      'wrappedVaultKeyEnvelope',
      'keyEpochId',
      'createdByUserId',
      'updatedByUserId',
      'revokedAt',
      'revokedByUserId',
      'createdAt',
      'updatedAt',
    ],
    foreignKeys: [
      { column: 'organisationId', references: 'organisations.id', onDelete: 'cascade' },
      { column: 'vaultId', references: 'password_vaults.id', onDelete: 'cascade' },
      { column: 'userId', references: 'users.id', onDelete: 'cascade' },
      { column: 'keyEpochId', references: 'password_vault_key_epochs.id', onDelete: 'restrict' },
      { column: 'createdByUserId', references: 'users.id', onDelete: 'restrict' },
      { column: 'updatedByUserId', references: 'users.id', onDelete: 'restrict' },
      { column: 'revokedByUserId', references: 'users.id', onDelete: 'set null' },
    ],
    uniqueKeys: [
      ['vaultId', 'userId'],
    ],
  },
  entries: {
    tableName: 'password_vault_entries',
    organisationScoped: true,
    requiredColumns: [
      'id',
      'organisationId',
      'vaultId',
      'encryptedPayloadEnvelope',
      'encryptedDisplayEnvelope',
      'envelopeVersion',
      'createdByUserId',
      'updatedByUserId',
      'deletedByUserId',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    foreignKeys: [
      { column: 'organisationId', references: 'organisations.id', onDelete: 'cascade' },
      { column: 'vaultId', references: 'password_vaults.id', onDelete: 'cascade' },
      { column: 'createdByUserId', references: 'users.id', onDelete: 'restrict' },
      { column: 'updatedByUserId', references: 'users.id', onDelete: 'restrict' },
      { column: 'deletedByUserId', references: 'users.id', onDelete: 'set null' },
    ],
  },
} as const

export const PASSWORD_VAULT_REQUIRED_TABLES = Object.values(
  PASSWORD_VAULT_TABLE_CONTRACT,
).map((table) => table.tableName)

export const PASSWORD_VAULT_ORG_SCOPED_TABLES = Object.values(
  PASSWORD_VAULT_TABLE_CONTRACT,
)
  .filter((table) => table.organisationScoped)
  .map((table) => table.tableName)

export const PASSWORD_VAULT_AUDIT_RELATIONSHIPS = [
  {
    tableName: 'password_vaults',
    actorColumns: ['createdByUserId', 'updatedByUserId', 'deletedByUserId'],
  },
  {
    tableName: 'password_vault_key_epochs',
    actorColumns: ['rotatedByUserId'],
  },
  {
    tableName: 'password_vault_members',
    actorColumns: ['createdByUserId', 'updatedByUserId', 'revokedByUserId'],
  },
  {
    tableName: 'password_vault_entries',
    actorColumns: ['createdByUserId', 'updatedByUserId', 'deletedByUserId'],
  },
] as const
