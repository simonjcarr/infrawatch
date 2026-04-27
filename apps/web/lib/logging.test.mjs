import test from 'node:test'
import assert from 'node:assert/strict'

import { redactLogValue, sanitiseErrorForLog } from './logging.ts'

test('redactLogValue redacts nested sensitive keys without dropping safe fields', () => {
  const value = redactLogValue({
    username: 'alice',
    token: 'secret-token',
    nested: {
      password: 'secret-password',
      ok: true,
    },
    channels: [
      { kind: 'smtp', bindPassword: 'ldap-secret' },
      { kind: 'slack', webhookUrl: 'https://example.com/hook' },
    ],
  })

  assert.deepEqual(value, {
    username: 'alice',
    token: '[REDACTED]',
    nested: {
      password: '[REDACTED]',
      ok: true,
    },
    channels: [
      { kind: 'smtp', bindPassword: '[REDACTED]' },
      { kind: 'slack', webhookUrl: 'https://example.com/hook' },
    ],
  })
})

test('sanitiseErrorForLog preserves basic error metadata and redacts attached config', () => {
  const error = new Error('Request failed')
  Object.assign(error, {
    code: 'EAUTH',
    config: {
      username: 'alerts@example.com',
      password: 'smtp-password',
      token: 'smtp-token',
    },
  })

  const safe = sanitiseErrorForLog(error)

  assert.equal(safe.name, 'Error')
  assert.equal(safe.message, 'Request failed')
  assert.equal(safe.code, 'EAUTH')
  assert.equal(safe.config, '[REDACTED]')
  assert.match(safe.stack, /Request failed/)
})

test('redactLogValue handles circular references', () => {
  const value = { name: 'loop' }
  value.self = value

  assert.deepEqual(redactLogValue(value), {
    name: 'loop',
    self: '[Circular]',
  })
})
