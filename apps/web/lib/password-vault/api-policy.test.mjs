import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PASSWORD_VAULT_API_POLICY,
  PASSWORD_VAULT_API_RATE_LIMITS,
  PASSWORD_VAULT_MAX_MUTATION_BODY_BYTES,
  PASSWORD_VAULT_MAX_READ_BODY_BYTES,
  PASSWORD_VAULT_MEMBER_ROLES,
  assertPasswordVaultMutationBodySize,
  assertPasswordVaultReadBodySize,
  findPasswordVaultRoutePolicy,
} from './api-policy.ts'

const routePolicies = Object.values(PASSWORD_VAULT_API_POLICY)

test('password vault API policy requires authenticated organisation sessions on every route', () => {
  assert.ok(routePolicies.length > 0)

  for (const policy of routePolicies) {
    assert.equal(policy.requiresSession, true, `${policy.id} must require a session`)
    assert.equal(policy.requiresOrganisation, true, `${policy.id} must require organisation scope`)
  }
})

test('password vault API policy scopes vault resources through organisation and active membership', () => {
  const vaultResourcePolicies = routePolicies.filter((policy) => policy.path.includes(':vaultId'))

  assert.ok(vaultResourcePolicies.length > 0)

  for (const policy of vaultResourcePolicies) {
    assert.equal(
      policy.vaultLookupScope,
      'organisation',
      `${policy.id} must load vaults through the actor organisation`,
    )
    assert.equal(
      policy.requiresActiveMembership,
      true,
      `${policy.id} must require non-revoked vault membership`,
    )
  }
})

test('password vault API policy applies least-privilege role gates to vault actions', () => {
  assert.deepEqual(
    PASSWORD_VAULT_API_POLICY.listEntries.allowedMemberRoles,
    PASSWORD_VAULT_MEMBER_ROLES,
  )
  assert.deepEqual(
    PASSWORD_VAULT_API_POLICY.createEntry.allowedMemberRoles,
    PASSWORD_VAULT_MEMBER_ROLES,
  )
  assert.deepEqual(
    PASSWORD_VAULT_API_POLICY.deleteVault.allowedMemberRoles,
    ['owner', 'admin'],
  )
  assert.deepEqual(
    PASSWORD_VAULT_API_POLICY.addMember.allowedMemberRoles,
    ['owner', 'admin'],
  )
  assert.deepEqual(
    PASSWORD_VAULT_API_POLICY.updateMember.allowedMemberRoles,
    ['owner', 'admin'],
  )
  assert.deepEqual(
    PASSWORD_VAULT_API_POLICY.rotateKeyEpoch.allowedMemberRoles,
    ['owner', 'admin'],
  )
})

test('password vault mutation routes require trusted origins and bounded request bodies', () => {
  const mutationPolicies = routePolicies.filter((policy) => policy.mutation)

  assert.ok(mutationPolicies.length > 0)

  for (const policy of mutationPolicies) {
    assert.equal(policy.requiresTrustedOrigin, true, `${policy.id} must reject untrusted origins`)
    assert.equal(
      policy.maxBodyBytes,
      PASSWORD_VAULT_MAX_MUTATION_BODY_BYTES,
      `${policy.id} must use the vault mutation body bound`,
    )
  }
})

test('password vault read routes reject request bodies to keep GET handlers side-effect free', () => {
  const readPolicies = routePolicies.filter((policy) => !policy.mutation)

  assert.ok(readPolicies.length > 0)

  for (const policy of readPolicies) {
    assert.equal(policy.requiresTrustedOrigin, false, `${policy.id} should not require mutation origin`)
    assert.equal(
      policy.maxBodyBytes,
      PASSWORD_VAULT_MAX_READ_BODY_BYTES,
      `${policy.id} must reject read request bodies`,
    )
  }
})

test('password vault API policy defines rate limits for sensitive flows', () => {
  assert.deepEqual(
    PASSWORD_VAULT_API_POLICY.putUserKey.rateLimit,
    PASSWORD_VAULT_API_RATE_LIMITS.setup,
  )
  assert.deepEqual(
    PASSWORD_VAULT_API_POLICY.unlockMetadata.rateLimit,
    PASSWORD_VAULT_API_RATE_LIMITS.unlock,
  )
  assert.deepEqual(
    PASSWORD_VAULT_API_POLICY.addMember.rateLimit,
    PASSWORD_VAULT_API_RATE_LIMITS.share,
  )
  assert.deepEqual(
    PASSWORD_VAULT_API_POLICY.revealAudit.rateLimit,
    PASSWORD_VAULT_API_RATE_LIMITS.sensitiveAudit,
  )
  assert.deepEqual(
    PASSWORD_VAULT_API_POLICY.copyAudit.rateLimit,
    PASSWORD_VAULT_API_RATE_LIMITS.sensitiveAudit,
  )
})

test('password vault API policy can be looked up by HTTP method and route template', () => {
  assert.equal(
    findPasswordVaultRoutePolicy('POST', '/api/password-vault/vaults/:vaultId/entries'),
    PASSWORD_VAULT_API_POLICY.createEntry,
  )
  assert.equal(
    findPasswordVaultRoutePolicy('delete', '/api/password-vault/vaults/:vaultId/members/:userId'),
    PASSWORD_VAULT_API_POLICY.removeMember,
  )
  assert.equal(findPasswordVaultRoutePolicy('POST', '/api/password-vault/unknown'), undefined)
})

test('password vault body bounds reject oversized payloads before validation or persistence', () => {
  assert.doesNotThrow(() => assertPasswordVaultMutationBodySize(PASSWORD_VAULT_MAX_MUTATION_BODY_BYTES))
  assert.throws(
    () => assertPasswordVaultMutationBodySize(PASSWORD_VAULT_MAX_MUTATION_BODY_BYTES + 1),
    /payload too large/i,
  )

  assert.doesNotThrow(() => assertPasswordVaultReadBodySize(0))
  assert.throws(
    () => assertPasswordVaultReadBodySize(1),
    /request body is not allowed/i,
  )
})
