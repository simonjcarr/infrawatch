import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getTwoFactorPolicyRedirect,
  isTwoFactorRequired,
} from './two-factor-policy.ts'

test('isTwoFactorRequired reads the instance security metadata flag', () => {
  assert.equal(isTwoFactorRequired({}), false)
  assert.equal(isTwoFactorRequired({ securitySettings: {} }), false)
  assert.equal(
    isTwoFactorRequired({ securitySettings: { requireTwoFactor: true } }),
    true,
  )
})

test('two-factor policy only redirects unprotected users away from non-setup paths', () => {
  const requiringOrg = { securitySettings: { requireTwoFactor: true } }

  assert.equal(
    getTwoFactorPolicyRedirect({
      metadata: requiringOrg,
      userTwoFactorEnabled: false,
      pathname: '/hosts',
    }),
    '/profile?setup=two-factor',
  )

  assert.equal(
    getTwoFactorPolicyRedirect({
      metadata: requiringOrg,
      userTwoFactorEnabled: false,
      pathname: '/profile',
    }),
    null,
  )

  assert.equal(
    getTwoFactorPolicyRedirect({
      metadata: requiringOrg,
      userTwoFactorEnabled: true,
      pathname: '/hosts',
    }),
    null,
  )

  assert.equal(
    getTwoFactorPolicyRedirect({
      metadata: {},
      userTwoFactorEnabled: false,
      pathname: '/hosts',
    }),
    null,
  )
})
