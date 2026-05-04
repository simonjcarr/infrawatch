import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PASSWORD_VAULT_AUDIT_ACTIONS,
  buildPasswordVaultAuditEvent,
  createPasswordVaultAuditResponse,
  parsePasswordVaultUnlockAuditPayload,
} from './audit-api.ts'

const base = {
  organisationId: 'org_123',
  actorUserId: 'user_123',
}

test('password vault audit helper emits stable action and target fields', () => {
  assert.deepEqual(buildPasswordVaultAuditEvent({
    ...base,
    event: 'entry_revealed',
    vaultId: 'vault_123',
    entryId: 'entry_123',
  }), {
    organisationId: 'org_123',
    actorUserId: 'user_123',
    action: PASSWORD_VAULT_AUDIT_ACTIONS.entry_revealed,
    targetType: 'password_vault_entry',
    targetId: 'entry_123',
    summary: 'Password Vault entry was revealed.',
    metadata: {
      vaultId: 'vault_123',
    },
  })

  assert.deepEqual(buildPasswordVaultAuditEvent({
    ...base,
    event: 'member_role_changed',
    vaultId: 'vault_123',
    targetUserId: 'user_456',
    role: 'admin',
  }).metadata, {
    vaultId: 'vault_123',
    targetUserId: 'user_456',
    role: 'admin',
  })
})

test('password vault audit metadata excludes secret and ciphertext material', () => {
  const audit = buildPasswordVaultAuditEvent({
    ...base,
    event: 'key_rotated',
    vaultId: 'vault_123',
    keyEpochId: 'epoch_123',
    keyEpochNumber: 4,
    rotationReason: 'membership_revoked',
    memberCount: 2,
  })

  const serialised = JSON.stringify(audit.metadata)
  assert.doesNotMatch(serialised, /ciphertext|encrypted|envelope|password|privateKey|publicKey|wrappedVaultKey/i)
  assert.match(serialised, /membership_revoked/)
})

test('password vault audit response is generic', () => {
  assert.deepEqual(createPasswordVaultAuditResponse(), { recorded: true })
})

test('password vault unlock audit payload only accepts outcome state', () => {
  assert.deepEqual(parsePasswordVaultUnlockAuditPayload({ result: 'success' }), { result: 'success' })

  assert.throws(
    () => parsePasswordVaultUnlockAuditPayload({
      result: 'failure',
      password: 'plaintext-secret',
    }),
    /unrecognized key/i,
  )
})
