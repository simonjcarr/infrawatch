import test from 'node:test'
import assert from 'node:assert/strict'

import { encrypt } from '../crypto/encrypt.ts'
import {
  getAuthEmailConfigFromEnv,
  getAuthEmailConfigFromOrgSettings,
} from './email.ts'

test('getAuthEmailConfigFromEnv returns null without required SMTP env vars', () => {
  assert.equal(getAuthEmailConfigFromEnv({}), null)
})

test('getAuthEmailConfigFromEnv maps AUTH_EMAIL_* vars into SMTP config', () => {
  assert.deepEqual(
    getAuthEmailConfigFromEnv({
      AUTH_EMAIL_SMTP_HOST: 'smtp.example.com',
      AUTH_EMAIL_SMTP_PORT: '465',
      AUTH_EMAIL_SMTP_SECURE: 'true',
      AUTH_EMAIL_SMTP_USER: 'mailer',
      AUTH_EMAIL_SMTP_PASSWORD: 'secret',
      AUTH_EMAIL_FROM: 'noreply@example.com',
      AUTH_EMAIL_FROM_NAME: 'CT-Ops Mailer',
    }),
    {
      host: 'smtp.example.com',
      port: 465,
      encryption: 'tls',
      username: 'mailer',
      password: 'secret',
      fromAddress: 'noreply@example.com',
      fromName: 'CT-Ops Mailer',
    },
  )
})

test('getAuthEmailConfigFromOrgSettings uses the enabled central relay and decrypts its password', () => {
  process.env.BETTER_AUTH_SECRET = '01234567890123456789012345678901'
  const encryptedPassword = encrypt('relay-secret')

  assert.deepEqual(
    getAuthEmailConfigFromOrgSettings({
      smtpRelay: {
        enabled: true,
        host: 'relay.example.com',
        port: 587,
        encryption: 'starttls',
        username: 'relay-user',
        passwordEncrypted: encryptedPassword,
        fromAddress: 'alerts@example.com',
        fromName: 'CT-Ops Alerts',
      },
    }),
    {
      host: 'relay.example.com',
      port: 587,
      encryption: 'starttls',
      username: 'relay-user',
      password: 'relay-secret',
      fromAddress: 'alerts@example.com',
      fromName: 'CT-Ops Alerts',
    },
  )
})

test('getAuthEmailConfigFromOrgSettings ignores disabled or missing relays', () => {
  assert.equal(getAuthEmailConfigFromOrgSettings(undefined), null)
  assert.equal(
    getAuthEmailConfigFromOrgSettings({
      smtpRelay: {
        enabled: false,
        host: 'relay.example.com',
        port: 587,
        encryption: 'starttls',
        fromAddress: 'alerts@example.com',
      },
    }),
    null,
  )
})
