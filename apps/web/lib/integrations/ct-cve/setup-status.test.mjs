import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCtCveConnectorSetupOverview } from './setup-status.ts'

const secret = Buffer.from('ct-cve connector setup unit test secret').toString('base64url')

test('summarises CT-CVE connector setup without exposing service-token secrets', async () => {
  const overview = await buildCtCveConnectorSetupOverview({
    orgId: 'org_1',
    env: {
      CT_CVE_SERVICE_TOKENS: JSON.stringify([
        {
          id: 'ct-cve-inbound',
          secret,
          orgId: 'org_1',
          scopes: ['findings:write', 'connection:read'],
        },
        {
          id: 'other-org',
          secret,
          orgId: 'org_2',
          scopes: ['findings:write'],
        },
      ]),
      CT_CVE_INVENTORY_PUSH_TARGETS: JSON.stringify([
        {
          name: 'Primary CT-CVE',
          baseUrl: 'https://ct-cve.example.invalid/',
          token: {
            id: 'ct-ops-inventory',
            secret,
            orgId: 'org_1',
            scopes: ['inventory:write'],
          },
        },
      ]),
    },
    statusRepository: {
      async get(orgId) {
        assert.equal(orgId, 'org_1')
        return {
          contractVersion: '2026-04-30',
          orgId: 'org_1',
          configured: true,
          enabled: true,
          lastInventoryPushAt: '2026-05-01T09:00:00.000Z',
          lastFindingIngestAt: null,
          lastHealthCheckAt: null,
          lastErrorCode: null,
          lastErrorAt: null,
        }
      },
      async save() {
        throw new Error('unexpected save')
      },
    },
  })

  assert.equal(overview.configured, true)
  assert.equal(overview.status.lastInventoryPushAt, '2026-05-01T09:00:00.000Z')
  assert.deepEqual(overview.inbound, {
    configured: true,
    tokenCount: 1,
    revokedTokenCount: 0,
    scopes: ['connection:read', 'findings:write'],
    error: null,
  })
  assert.deepEqual(overview.inventoryPush, {
    configured: true,
    targetCount: 1,
    targets: [{ name: 'Primary CT-CVE', baseUrl: 'https://ct-cve.example.invalid' }],
    error: null,
  })
  assert.equal(JSON.stringify(overview).includes(secret), false)
  assert.equal(JSON.stringify(overview).includes('ct-cve-inbound'), false)
  assert.equal(JSON.stringify(overview).includes('ct-ops-inventory'), false)
})

test('reports malformed connector environment without throwing', async () => {
  const overview = await buildCtCveConnectorSetupOverview({
    orgId: 'org_1',
    env: {
      CT_CVE_SERVICE_TOKENS: '{not json',
      CT_CVE_INVENTORY_PUSH_TARGETS: JSON.stringify([
        {
          name: 'broken',
          baseUrl: 'https://ct-cve.example.invalid',
          token: { id: 'id', secret: 'short', orgId: 'org_1', scopes: ['inventory:write'] },
        },
      ]),
    },
    statusRepository: {
      async get() {
        return null
      },
      async save() {
        throw new Error('unexpected save')
      },
    },
  })

  assert.equal(overview.configured, false)
  assert.equal(overview.inbound.configured, false)
  assert.match(overview.inbound.error ?? '', /CT_CVE_SERVICE_TOKENS/)
  assert.equal(overview.inventoryPush.configured, false)
  assert.match(overview.inventoryPush.error ?? '', /token\.secret/)
  assert.equal(overview.status.configured, false)
})
