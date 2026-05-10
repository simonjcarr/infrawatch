import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCtCveCtOpsConnectionConfig,
  normaliseCtCveBaseUrl,
  normaliseCtCveConnectorSettingsForSave,
  toCtCveInventoryPushTarget,
  toCtCveServiceToken,
} from './connector-settings.ts'

const inventorySecret = Buffer.from('ct-ops inventory signing secret for tests').toString('base64url')
const ctCveSecret = Buffer.from('ct-cve finding signing secret for tests').toString('base64url')

test('normalises CT-CVE connector settings and generates missing first-save secrets', () => {
  const generated = [
    Buffer.from('generated inventory secret for first save').toString('base64url'),
    Buffer.from('generated ct-cve secret for first save').toString('base64url'),
  ]

  const saved = normaliseCtCveConnectorSettingsForSave({
    instanceId: 'org_123',
    input: {
      enabled: true,
      name: '  Production CT-CVE  ',
      baseUrl: 'https://ct-cve.example.invalid/api/?ignored=1#section',
      inventoryTokenId: '  ctops_inventory_org_123  ',
      inventoryTokenSecret: '',
      ctCveTokenId: ' ctcve_findings_org_123 ',
      ctCveTokenSecret: '',
    },
    generateSecret: () => generated.shift() ?? 'unexpected',
    encryptSecret: (value) => `enc:${value}`,
  })

  assert.deepEqual(saved, {
    instanceId: 'org_123',
    enabled: true,
    name: 'Production CT-CVE',
    baseUrl: 'https://ct-cve.example.invalid/api',
    inventoryTokenId: 'ctops_inventory_org_123',
    inventoryTokenSecretEncrypted: `enc:${Buffer.from('generated inventory secret for first save').toString('base64url')}`,
    ctCveTokenId: 'ctcve_findings_org_123',
    ctCveTokenSecretEncrypted: `enc:${Buffer.from('generated ct-cve secret for first save').toString('base64url')}`,
  })
})

test('preserves stored secrets when update form leaves secret fields blank', () => {
  const saved = normaliseCtCveConnectorSettingsForSave({
    instanceId: 'org_123',
    input: {
      enabled: false,
      name: 'Primary CT-CVE',
      baseUrl: 'https://ct-cve.example.invalid/',
      inventoryTokenId: 'ctops_inventory_org_123',
      inventoryTokenSecret: '   ',
      ctCveTokenId: 'ctcve_findings_org_123',
      ctCveTokenSecret: '',
    },
    existing: {
      inventoryTokenSecretEncrypted: 'enc:old-inventory',
      ctCveTokenSecretEncrypted: 'enc:old-ctcve',
    },
    generateSecret: () => {
      throw new Error('unexpected secret generation')
    },
    encryptSecret: (value) => `enc:${value}`,
  })

  assert.equal(saved.enabled, false)
  assert.equal(saved.baseUrl, 'https://ct-cve.example.invalid')
  assert.equal(saved.inventoryTokenSecretEncrypted, 'enc:old-inventory')
  assert.equal(saved.ctCveTokenSecretEncrypted, 'enc:old-ctcve')
})

test('rejects invalid connector URL, token IDs, and weak secrets', () => {
  assert.throws(
    () => normaliseCtCveBaseUrl('file:///tmp/ct-cve'),
    /absolute http\(s\) URL/,
  )
  assert.throws(
    () => normaliseCtCveConnectorSettingsForSave({
      instanceId: 'org_123',
      input: {
        enabled: true,
        name: 'Primary CT-CVE',
        baseUrl: 'https://ct-cve.example.invalid',
        inventoryTokenId: 'not a token id',
        inventoryTokenSecret: inventorySecret,
        ctCveTokenId: 'ctcve_findings_org_123',
        ctCveTokenSecret: ctCveSecret,
      },
      encryptSecret: (value) => value,
    }),
    /Inventory token ID/,
  )
  assert.throws(
    () => normaliseCtCveConnectorSettingsForSave({
      instanceId: 'org_123',
      input: {
        enabled: true,
        name: 'Primary CT-CVE',
        baseUrl: 'https://ct-cve.example.invalid',
        inventoryTokenId: 'ctops_inventory_org_123',
        inventoryTokenSecret: 'short',
        ctCveTokenId: 'ctcve_findings_org_123',
        ctCveTokenSecret: ctCveSecret,
      },
      encryptSecret: (value) => value,
    }),
    /Inventory token secret must contain at least 32 bytes/,
  )
})

test('converts stored connector settings into both CTOPS runtime tokens and CT-CVE config', () => {
  const settings = {
    instanceId: 'org_123',
    enabled: true,
    name: 'Primary CT-CVE',
    baseUrl: 'https://ct-cve.example.invalid',
    inventoryTokenId: 'ctops_inventory_org_123',
    inventoryTokenSecret: inventorySecret,
    ctCveTokenId: 'ctcve_findings_org_123',
    ctCveTokenSecret: ctCveSecret,
  }

  assert.deepEqual(toCtCveInventoryPushTarget(settings), {
    name: 'Primary CT-CVE',
    enabled: true,
    baseUrl: 'https://ct-cve.example.invalid',
    token: {
      id: 'ctops_inventory_org_123',
      secret: inventorySecret,
      instanceId: 'org_123',
      scopes: ['inventory:write', 'connection:read'],
    },
  })

  assert.deepEqual(toCtCveServiceToken(settings), {
    id: 'ctcve_findings_org_123',
    secret: ctCveSecret,
    instanceId: 'org_123',
    scopes: ['findings:write', 'connection:read'],
    revoked: false,
  })

  assert.deepEqual(buildCtCveCtOpsConnectionConfig(settings, 'https://ct-ops.example.invalid/settings'), {
    name: 'Primary CT-CVE',
    instanceId: 'org_123',
    ctOpsBaseUrl: 'https://ct-ops.example.invalid',
    inventoryTokens: [{
      id: 'ctops_inventory_org_123',
      secret: inventorySecret,
      scopes: ['inventory:write', 'connection:read'],
    }],
    ctOpsToken: {
      id: 'ctcve_findings_org_123',
      secret: ctCveSecret,
      scopes: ['findings:write', 'connection:read'],
    },
  })
})
