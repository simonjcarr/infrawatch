import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCtCveConnectorSetupOverview } from './setup-status.ts'

test('summarises DB-backed CT-CVE connector settings without exposing token identifiers or secrets', async () => {
  const overview = await buildCtCveConnectorSetupOverview({
    orgId: 'org_1',
    settingsRepository: {
      async getSummary(orgId) {
        assert.equal(orgId, 'org_1')
        return {
          organisationId: 'org_1',
          enabled: true,
          name: 'Primary CT-CVE',
          baseUrl: 'https://ct-cve.example.invalid',
          inventoryTokenId: 'ctops_inventory_org_1',
          ctCveTokenId: 'ctcve_findings_org_1',
          hasInventoryTokenSecret: true,
          hasCtCveTokenSecret: true,
        }
      },
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
  assert.equal(overview.enabled, true)
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
  assert.equal(JSON.stringify(overview).includes('ctcve_findings_org_1'), false)
  assert.equal(JSON.stringify(overview).includes('ctops_inventory_org_1'), false)
})

test('reports missing CT-CVE app settings as unconfigured', async () => {
  const overview = await buildCtCveConnectorSetupOverview({
    orgId: 'org_1',
    settingsRepository: {
      async getSummary(orgId) {
        assert.equal(orgId, 'org_1')
        return null
      },
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
  assert.equal(overview.enabled, false)
  assert.equal(overview.inbound.configured, false)
  assert.equal(overview.inventoryPush.configured, false)
  assert.equal(overview.status.configured, false)
})
