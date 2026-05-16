import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildSignedModuleRequestHeaders,
  normaliseModuleBaseUrl,
  normaliseModuleTokenId,
} from './service-token.ts'

test('normalises module base URLs without paths query strings or fragments', () => {
  assert.equal(normaliseModuleBaseUrl('https://ansible.example.test/api?x=1#frag'), 'https://ansible.example.test/api')
})

test('rejects unsupported module base URL schemes', () => {
  assert.throws(() => normaliseModuleBaseUrl('file:///tmp/ansible'), /absolute http\(s\) URL/)
})

test('normalises module token IDs to contract-safe values', () => {
  assert.equal(normaliseModuleTokenId(' ansible.token-1 '), 'ansible.token-1')
  assert.throws(() => normaliseModuleTokenId('bad token'), /letters, numbers/)
})

test('builds deterministic HMAC service-token headers for module calls', () => {
  const headers = buildSignedModuleRequestHeaders({
    method: 'POST',
    path: '/api/v1/runs/ansible-ping',
    body: '{"ok":true}',
    token: {
      id: 'ansible-token',
      secret: 'ansible signing secret with enough entropy',
    },
    timestamp: '2026-05-15T12:00:00.000Z',
    nonce: 'nonce-1',
  })

  assert.equal(headers.authorization, 'CT-ServiceToken ansible-token')
  assert.equal(headers['x-ct-timestamp'], '2026-05-15T12:00:00.000Z')
  assert.equal(headers['x-ct-nonce'], 'nonce-1')
  assert.match(headers['x-ct-content-sha256'], /^[a-f0-9]{64}$/)
  assert.match(headers['x-ct-signature'], /^v1=[A-Za-z0-9_-]+$/)
})
