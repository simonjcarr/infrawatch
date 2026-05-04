import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const schemaFile = path.resolve(import.meta.dirname, 'password-vault.ts')
const schemaIndexFile = path.resolve(import.meta.dirname, 'index.ts')
const e2eFixtureFile = path.resolve(import.meta.dirname, '../../../tests/e2e/fixtures/db.ts')

test('password vault schema exports a dedicated module from the schema index', () => {
  assert.equal(fs.existsSync(schemaFile), true, 'expected password-vault.ts schema module to exist')

  const indexSource = fs.readFileSync(schemaIndexFile, 'utf8')
  assert.match(indexSource, /export \* from '\.\/password-vault\.ts'/)
})

test('password vault schema module defines the planned tables and key constraints', () => {
  const source = fs.readFileSync(schemaFile, 'utf8')

  for (const tableName of [
    'password_vault_user_keys',
    'password_vaults',
    'password_vault_key_epochs',
    'password_vault_members',
    'password_vault_entries',
  ]) {
    assert.match(source, new RegExp(`pgTable\\([\\s\\S]*'${tableName}'`))
  }

  for (const columnName of [
    'encrypted_private_key_envelope',
    'kdf_params',
    'encrypted_display_envelope',
    'epoch_number',
    'wrapped_vault_key_envelope',
    'encrypted_payload_envelope',
  ]) {
    assert.match(source, new RegExp(`'${columnName}'`))
  }

  assert.match(source, /uniqueIndex\('password_vault_user_keys_user_uidx'\)\.on\(t\.userId\)/)
  assert.match(
    source,
    /uniqueIndex\('password_vault_key_epochs_vault_epoch_uidx'\)\.on\(t\.vaultId, t\.epochNumber\)/,
  )
  assert.match(
    source,
    /uniqueIndex\('password_vault_members_vault_user_uidx'\)\.on\(t\.vaultId, t\.userId\)/,
  )
})

test('password vault e2e fixtures truncate the new vault tables', () => {
  const source = fs.readFileSync(e2eFixtureFile, 'utf8')

  for (const tableName of [
    'password_vault_entries',
    'password_vault_members',
    'password_vault_key_epochs',
    'password_vaults',
    'password_vault_user_keys',
  ]) {
    assert.match(source, new RegExp(`'${tableName}'`))
  }
})
