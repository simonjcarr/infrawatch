import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PASSWORD_VAULT_AUDIT_RELATIONSHIPS,
  PASSWORD_VAULT_ORG_SCOPED_TABLES,
  PASSWORD_VAULT_REQUIRED_TABLES,
  PASSWORD_VAULT_SECRET_FIELDS,
  PASSWORD_VAULT_TABLE_CONTRACT,
} from './password-vault.contract.ts'

test('password vault schema contract covers the planned table set', () => {
  assert.deepEqual(
    PASSWORD_VAULT_REQUIRED_TABLES,
    [
      'password_vault_user_keys',
      'password_vaults',
      'password_vault_key_epochs',
      'password_vault_members',
      'password_vault_entries',
    ],
  )
})

test('password vault schema contract identifies organisation-scoped tables', () => {
  assert.deepEqual(
    PASSWORD_VAULT_ORG_SCOPED_TABLES,
    [
      'password_vaults',
      'password_vault_key_epochs',
      'password_vault_members',
      'password_vault_entries',
    ],
  )
})

test('password vault schema contract encodes the required membership and key epoch constraints', () => {
  assert.deepEqual(PASSWORD_VAULT_TABLE_CONTRACT.keyEpochs.uniqueKeys, [['vaultId', 'epochNumber']])
  assert.deepEqual(PASSWORD_VAULT_TABLE_CONTRACT.members.uniqueKeys, [['vaultId', 'userId']])
  assert.deepEqual(
    PASSWORD_VAULT_TABLE_CONTRACT.members.foreignKeys.map((key) => key.column),
    [
      'organisationId',
      'vaultId',
      'userId',
      'keyEpochId',
      'createdByUserId',
      'updatedByUserId',
      'revokedByUserId',
    ],
  )
})

test('password vault schema contract keeps secret-bearing fields out of plaintext column plans', () => {
  const secretFieldSet = new Set(PASSWORD_VAULT_SECRET_FIELDS)

  for (const table of Object.values(PASSWORD_VAULT_TABLE_CONTRACT)) {
    for (const column of table.requiredColumns) {
      assert.equal(
        secretFieldSet.has(column),
        false,
        `${table.tableName} should not plan a plaintext secret column named ${column}`,
      )
    }
  }
})

test('password vault schema contract records audit actor relationships for mutable tables', () => {
  assert.deepEqual(PASSWORD_VAULT_AUDIT_RELATIONSHIPS, [
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
  ])
})
