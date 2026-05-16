import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MODULE_CONTRACT_VERSION,
  normaliseModuleConnectionForSave,
  publicModuleConnectionSummary,
} from './module-connections-core.ts'

const secret = 'module connection test secret with enough entropy'

test('normalises module connection settings for storage', () => {
  const saved = normaliseModuleConnectionForSave({
    instanceId: 'ct-ops-dev',
    input: {
      moduleType: 'ansible',
      enabled: true,
      name: ' Primary Ansible ',
      baseUrl: 'https://ansible.example.test/',
      authMode: 'service-token-hmac',
      tokenId: ' ansible-api ',
      tokenSecret: secret,
      tlsMode: 'public-ca',
      timeoutMs: 5000,
    },
    encryptSecret: (value) => `enc:${value}`,
  })

  assert.equal(saved.instanceId, 'ct-ops-dev')
  assert.equal(saved.moduleType, 'ansible')
  assert.equal(saved.contractVersion, MODULE_CONTRACT_VERSION)
  assert.equal(saved.name, 'Primary Ansible')
  assert.equal(saved.baseUrl, 'https://ansible.example.test')
  assert.equal(saved.authMode, 'service-token-hmac')
  assert.equal(saved.tokenId, 'ansible-api')
  assert.equal(saved.tokenSecretEncrypted, `enc:${secret}`)
  assert.equal(saved.tlsMode, 'public-ca')
  assert.equal(saved.timeoutMs, 5000)
})

test('requires a token secret for hmac-authenticated module connections', () => {
  assert.throws(() => normaliseModuleConnectionForSave({
    instanceId: 'ct-ops-dev',
    input: {
      moduleType: 'ansible',
      enabled: true,
      name: 'Ansible',
      baseUrl: 'https://ansible.example.test',
      authMode: 'service-token-hmac',
      tokenId: 'ansible-api',
      tokenSecret: '',
      tlsMode: 'public-ca',
    },
    encryptSecret: (value) => value,
  }), /token secret is required/)
})

test('requires insecure TLS mode for plain HTTP module URLs', () => {
  assert.throws(() => normaliseModuleConnectionForSave({
    instanceId: 'ct-ops-dev',
    input: {
      moduleType: 'ansible',
      enabled: true,
      name: 'Ansible',
      baseUrl: 'http://ansible-api:8080',
      authMode: 'none',
      tlsMode: 'public-ca',
    },
    encryptSecret: (value) => value,
  }), /HTTP module URLs require the insecure TLS mode/)
})

test('allows explicit insecure TLS mode for private plain HTTP module URLs', () => {
  const saved = normaliseModuleConnectionForSave({
    instanceId: 'ct-ops-dev',
    input: {
      moduleType: 'ansible',
      enabled: true,
      name: 'Ansible',
      baseUrl: 'http://ansible-api:8080',
      authMode: 'none',
      tlsMode: 'insecure',
    },
    encryptSecret: (value) => value,
  })
  assert.equal(saved.baseUrl, 'http://ansible-api:8080')
  assert.equal(saved.tlsMode, 'insecure')
})

test('public summaries do not expose encrypted module token material', () => {
  const summary = publicModuleConnectionSummary({
    id: 'mod_1',
    instanceId: 'ct-ops-dev',
    moduleType: 'ansible',
    enabled: true,
    name: 'Ansible',
    baseUrl: 'https://ansible.example.test',
    contractVersion: MODULE_CONTRACT_VERSION,
    authMode: 'service-token-hmac',
    tokenId: 'ansible-api',
    tokenSecretEncrypted: 'encrypted-secret',
    tlsMode: 'public-ca',
    caCertificate: null,
    serverCertificateSha256: null,
    timeoutMs: 5000,
    createdAt: new Date('2026-05-15T10:00:00Z'),
    updatedAt: new Date('2026-05-15T10:00:00Z'),
    deletedAt: null,
  })

  assert.equal(summary.hasTokenSecret, true)
  assert.equal('tokenSecretEncrypted' in summary, false)
})
