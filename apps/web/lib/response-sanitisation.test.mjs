import test from 'node:test'
import assert from 'node:assert/strict'

import { sanitise } from './response-sanitisation.ts'

test('sanitise omits configured top-level fields', () => {
  const safe = sanitise({
    id: 'cfg_123',
    bindDn: 'cn=svc,dc=example,dc=com',
    bindPassword: 'ciphertext',
    allowLogin: true,
  }, {
    bindPassword: 'omit',
  })

  assert.deepEqual(safe, {
    id: 'cfg_123',
    bindDn: 'cn=svc,dc=example,dc=com',
    allowLogin: true,
  })
})

test('sanitise omits configured nested fields', () => {
  const safe = sanitise({
    channel: {
      url: 'https://hooks.example.com',
      secret: 'super-secret',
    },
    untouched: 'value',
  }, {
    channel: {
      secret: 'omit',
    },
  })

  assert.deepEqual(safe, {
    channel: {
      url: 'https://hooks.example.com',
    },
    untouched: 'value',
  })
})
