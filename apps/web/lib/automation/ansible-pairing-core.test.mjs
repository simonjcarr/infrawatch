import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAnsiblePairingConnectionInput,
  inferAnsibleTlsMode,
} from './ansible-pairing-core.ts'

test('infers insecure TLS mode only for HTTP Ansible URLs', () => {
  assert.equal(inferAnsibleTlsMode('http://ansible-api:8080'), 'insecure')
  assert.equal(inferAnsibleTlsMode('https://ansible-api.example.test'), 'public-ca')
})

test('builds an HMAC module connection from a pairing response', () => {
  const input = buildAnsiblePairingConnectionInput({
    baseUrl: ' https://ansible-api.example.test/ ',
    tokenId: 'ansible-api',
    tokenSecret: 'generated ansible secret with enough entropy',
  })

  assert.deepEqual(input, {
    enabled: true,
    name: 'Primary Ansible API',
    baseUrl: 'https://ansible-api.example.test/',
    authMode: 'service-token-hmac',
    tokenId: 'ansible-api',
    tokenSecret: 'generated ansible secret with enough entropy',
    tlsMode: 'public-ca',
    timeoutMs: 5000,
  })
})
