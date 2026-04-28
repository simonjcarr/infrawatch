import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SMTP_ALLOWED_PORTS,
  normaliseSmtpRecipients,
  sanitiseSmtpRelayForClient,
  normaliseSmtpTestRecipient,
} from './smtp-settings.ts'

test('normaliseSmtpRecipients trims comma-separated addresses and rejects empty output', () => {
  assert.deepEqual(normaliseSmtpRecipients('ops@example.com, team@example.com,, '), [
    'ops@example.com',
    'team@example.com',
  ])
  assert.throws(() => normaliseSmtpRecipients(' , '), /At least one recipient/)
})

test('normaliseSmtpTestRecipient accepts one trimmed email address only', () => {
  assert.equal(normaliseSmtpTestRecipient(' ops@example.com '), 'ops@example.com')
  assert.throws(() => normaliseSmtpTestRecipient('ops@example.com, team@example.com'), /Enter one email address/)
  assert.throws(() => normaliseSmtpTestRecipient('not-an-email'), /valid email address/)
})

test('sanitiseSmtpRelayForClient hides stored password material', () => {
  const safe = sanitiseSmtpRelayForClient({
    enabled: true,
    host: 'smtp.example.com',
    port: 587,
    encryption: 'starttls',
    username: 'alerts@example.com',
    passwordEncrypted: 'secret-ciphertext',
    fromAddress: 'alerts@example.com',
    fromName: 'CT-Ops Alerts',
  })

  assert.deepEqual(safe, {
    enabled: true,
    host: 'smtp.example.com',
    port: 587,
    encryption: 'starttls',
    username: 'alerts@example.com',
    hasPassword: true,
    fromAddress: 'alerts@example.com',
    fromName: 'CT-Ops Alerts',
  })
})

test('SMTP_ALLOWED_PORTS documents the supported relay ports', () => {
  assert.deepEqual(SMTP_ALLOWED_PORTS, [25, 465, 587, 2525])
})
