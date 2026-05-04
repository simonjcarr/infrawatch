import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PASSWORD_VAULT_KEY_ROTATION_IDEMPOTENCY_VERSION,
  createPasswordVaultKeyEpochResponse,
  createPasswordVaultMemberDeletedResponse,
  parseAddPasswordVaultMemberPayload,
  parseRotatePasswordVaultKeyEpochPayload,
  parseUpdatePasswordVaultMemberPayload,
  serializePasswordVaultMember,
  willLeaveVaultWithoutOwner,
} from './sharing-api.ts'

const wrappedVaultKeyEnvelope = {
  version: 1,
  algorithm: 'AES-256-GCM',
  iv: 'memberWrappedIv01',
  ciphertext: 'memberWrappedCiphertext000000000000000000000000',
  wrapVersion: 1,
  salt: 'memberWrapSalt000',
}

const memberRecord = {
  userId: 'user_12345678',
  name: 'Morgan Admin',
  email: 'morgan@example.test',
  role: 'admin',
  keyEpochId: 'epoch',
  keyEpochNumber: 3,
  createdAt: new Date('2026-05-04T18:10:00.000Z'),
  updatedAt: new Date('2026-05-04T18:15:00.000Z'),
  revokedAt: null,
}

test('password vault add-member payload accepts only member identity and encrypted key material', () => {
  const payload = {
    userId: 'user_target123',
    role: 'member',
    wrappedVaultKeyEnvelope,
    idempotencyKey: 'share-request-001',
  }

  assert.deepEqual(parseAddPasswordVaultMemberPayload(payload), payload)

  assert.throws(
    () => parseAddPasswordVaultMemberPayload({
      ...payload,
      password: 'plaintext-secret',
    }),
    /unrecognized key/i,
  )

  assert.throws(
    () => parseAddPasswordVaultMemberPayload({
      ...payload,
      wrappedVaultKeyEnvelope: {
        ...wrappedVaultKeyEnvelope,
        vaultKey: 'plaintext-vault-key',
      },
    }),
    /unrecognized key/i,
  )
})

test('password vault member updates require an explicit role and optional encrypted rewrap', () => {
  assert.deepEqual(parseUpdatePasswordVaultMemberPayload({
    role: 'admin',
    wrappedVaultKeyEnvelope,
    idempotencyKey: 'role-change-001',
  }), {
    role: 'admin',
    wrappedVaultKeyEnvelope,
    idempotencyKey: 'role-change-001',
  })

  assert.throws(
    () => parseUpdatePasswordVaultMemberPayload({
      role: 'owner',
      note: 'make them owner',
    }),
    /unrecognized key/i,
  )
})

test('password vault key rotation payload requires wraps for remaining members', () => {
  const payload = {
    rotationReason: 'membership_revoked',
    idempotencyKey: 'rotation-001',
    memberKeyWraps: [
      { userId: 'user_owner123', wrappedVaultKeyEnvelope },
      { userId: 'user_admin123', wrappedVaultKeyEnvelope },
    ],
  }

  assert.deepEqual(parseRotatePasswordVaultKeyEpochPayload(payload), payload)

  assert.throws(
    () => parseRotatePasswordVaultKeyEpochPayload({
      ...payload,
      idempotencyKey: '',
    }),
    /too small/i,
  )

  assert.throws(
    () => parseRotatePasswordVaultKeyEpochPayload({
      ...payload,
      memberKeyWraps: [],
    }),
    /too small/i,
  )
})

test('password vault member serialization omits encrypted key material and organisation internals', () => {
  const response = serializePasswordVaultMember({
    ...memberRecord,
    organisationId: 'org_123',
    wrappedVaultKeyEnvelope,
  })

  assert.deepEqual(response, {
    userId: 'user_12345678',
    name: 'Morgan Admin',
    email: 'morgan@example.test',
    role: 'admin',
    keyEpoch: {
      id: 'epoch',
      epochNumber: 3,
    },
    createdAt: '2026-05-04T18:10:00.000Z',
    updatedAt: '2026-05-04T18:15:00.000Z',
    revokedAt: null,
  })
  assert.equal('organisationId' in response, false)
  assert.equal('wrappedVaultKeyEnvelope' in response, false)
})

test('password vault sharing helpers protect against removing or demoting the last owner', () => {
  assert.equal(willLeaveVaultWithoutOwner({
    activeOwnerUserIds: ['user_owner123'],
    targetUserId: 'user_owner123',
    replacementRole: 'admin',
  }), true)
  assert.equal(willLeaveVaultWithoutOwner({
    activeOwnerUserIds: ['user_owner123', 'user_owner456'],
    targetUserId: 'user_owner123',
    replacementRole: 'member',
  }), false)
  assert.equal(willLeaveVaultWithoutOwner({
    activeOwnerUserIds: ['user_owner123'],
    targetUserId: 'user_admin123',
    replacementRole: null,
  }), false)
})

test('password vault key epoch and delete responses are generic and idempotency-aware', () => {
  assert.deepEqual(createPasswordVaultMemberDeletedResponse('user_12345678'), {
    userId: 'user_12345678',
    deleted: true,
  })

  assert.deepEqual(createPasswordVaultKeyEpochResponse({
    id: 'epoch_12345678',
    epochNumber: 4,
    rotationReason: 'membership_revoked',
    idempotencyKey: 'rotation-001',
    createdAt: new Date('2026-05-04T18:20:00.000Z'),
  }), {
    id: 'epoch_12345678',
    epochNumber: 4,
    rotationReason: 'membership_revoked',
    idempotencyKey: 'rotation-001',
    idempotencyVersion: PASSWORD_VAULT_KEY_ROTATION_IDEMPOTENCY_VERSION,
    createdAt: '2026-05-04T18:20:00.000Z',
  })
})
