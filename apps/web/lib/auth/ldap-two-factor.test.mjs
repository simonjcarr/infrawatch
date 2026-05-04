import test from 'node:test'
import assert from 'node:assert/strict'

import { symmetricEncrypt } from 'better-auth/crypto'

import {
  createSignedLdapTwoFactorCookieValue,
  generateTotpCode,
  parseLdapTwoFactorChallenge,
  readSignedLdapTwoFactorCookieValue,
  serialiseLdapTwoFactorChallenge,
  verifyLdapTwoFactorCode,
} from './ldap-two-factor.ts'

const secret = 'ldap-2fa-test-secret'

test('signed LDAP 2FA cookie values round-trip and reject tampering', async () => {
  const signed = await createSignedLdapTwoFactorCookieValue('ldap-2fa-123', secret)

  assert.equal(await readSignedLdapTwoFactorCookieValue(signed, secret), 'ldap-2fa-123')
  assert.equal(await readSignedLdapTwoFactorCookieValue(`${signed}tamper`, secret), null)
})

test('LDAP 2FA challenge payload round-trips and rejects malformed values', () => {
  const encoded = serialiseLdapTwoFactorChallenge({
    userId: 'user-123',
    username: 'jsmith',
  })

  assert.deepEqual(parseLdapTwoFactorChallenge(encoded), {
    userId: 'user-123',
    username: 'jsmith',
  })
  assert.equal(parseLdapTwoFactorChallenge('{"userId":1}'), null)
  assert.equal(parseLdapTwoFactorChallenge('not-json'), null)
})

test('LDAP TOTP verification accepts a valid authenticator code', async () => {
  const totpSecret = 'TOTP_SHARED_SECRET_1234567890'
  const encryptedSecret = await symmetricEncrypt({
    key: secret,
    data: totpSecret,
  })
  const code = generateTotpCode({
    secret: totpSecret,
    digits: 6,
    period: 30,
  })

  assert.deepEqual(
    await verifyLdapTwoFactorCode({
      credential: {
        secret: encryptedSecret,
        backupCodes: null,
      },
      method: 'totp',
      code,
      secret,
    }),
    { ok: true },
  )

  assert.deepEqual(
    await verifyLdapTwoFactorCode({
      credential: {
        secret: encryptedSecret,
        backupCodes: null,
      },
      method: 'totp',
      code: '000000',
      secret,
    }),
    { ok: false },
  )
})

test('LDAP backup-code verification consumes a matching code', async () => {
  const backupCodes = ['ABCDE-12345', 'FGHIJ-67890']
  const encryptedBackupCodes = await symmetricEncrypt({
    key: secret,
    data: JSON.stringify(backupCodes),
  })

  assert.deepEqual(
    await verifyLdapTwoFactorCode({
      credential: {
        secret: await symmetricEncrypt({ key: secret, data: 'unused' }),
        backupCodes: encryptedBackupCodes,
      },
      method: 'backup_code',
      code: 'ABCDE-12345',
      secret,
    }),
    {
      ok: true,
      backupCode: {
        remainingCodes: ['FGHIJ-67890'],
      },
    },
  )

  assert.deepEqual(
    await verifyLdapTwoFactorCode({
      credential: {
        secret: await symmetricEncrypt({ key: secret, data: 'unused' }),
        backupCodes: encryptedBackupCodes,
      },
      method: 'backup_code',
      code: 'WRONG-00000',
      secret,
    }),
    { ok: false },
  )
})
