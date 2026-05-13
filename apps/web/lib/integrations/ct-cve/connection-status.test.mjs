import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getCtCveConnectionStatus,
  recordCtCveConnectionError,
  recordCtCveConnectionHealth,
  recordCtCveFindingIngest,
  recordCtCveInventoryPush,
} from './connection-status.ts'

function repo(initial = null) {
  let stored = initial
  return {
    repository: {
      async get(instanceId) {
        assert.equal(instanceId, 'instance_1')
        return stored
      },
      async save(status) {
        assert.equal(status.instanceId, 'instance_1')
        stored = status
      },
    },
    stored: () => stored,
  }
}

test('returns default CT-CVE connection status when no durable row exists', async () => {
  const { repository } = repo()

  const status = await getCtCveConnectionStatus('instance_1', { configured: false, repository })

  assert.deepEqual(status, {
    contractVersion: '2026-04-30',
    instanceId: 'instance_1',
    configured: false,
    enabled: true,
    lastInventoryPushAt: null,
    lastFindingIngestAt: null,
    lastHealthCheckAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
  })
})

test('records health, finding ingest, inventory push, and clears stale errors on successful data flow', async () => {
  const { repository, stored } = repo()

  await recordCtCveConnectionHealth('instance_1', {
    repository,
    now: new Date('2026-04-30T11:00:00.000Z'),
  })
  await recordCtCveConnectionError('instance_1', 'inventory_push_failed', {
    repository,
    now: new Date('2026-04-30T11:01:00.000Z'),
  })
  await recordCtCveFindingIngest('instance_1', {
    repository,
    now: new Date('2026-04-30T11:02:00.000Z'),
  })
  await recordCtCveInventoryPush('instance_1', {
    repository,
    now: new Date('2026-04-30T11:03:00.000Z'),
  })

  assert.deepEqual(stored(), {
    contractVersion: '2026-04-30',
    instanceId: 'instance_1',
    configured: true,
    enabled: true,
    lastInventoryPushAt: '2026-04-30T11:03:00.000Z',
    lastFindingIngestAt: '2026-04-30T11:02:00.000Z',
    lastHealthCheckAt: '2026-04-30T11:00:00.000Z',
    lastErrorCode: null,
    lastErrorAt: null,
  })
})
