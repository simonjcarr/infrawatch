import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateIngestHealthSummary,
  calculateAgentUpgradeSummary,
} from './health.ts'

test('calculateAgentUpgradeSummary counts agents that still need the required version', () => {
  const summary = calculateAgentUpgradeSummary([
    { version: 'v0.32.2' },
    { version: 'v0.32.1' },
    { version: null },
    { version: 'dev' },
  ], 'v0.32.2')

  assert.deepEqual(summary, {
    requiredVersion: 'v0.32.2',
    notUpgraded: 2,
    unknownVersion: 1,
  })
})

test('calculateIngestHealthSummary derives online status and message deltas from snapshots', () => {
  const now = new Date('2026-04-28T12:00:00.000Z')
  const snapshots = [
    {
      serverId: 'ingest-a',
      observedAt: new Date('2026-04-28T11:59:30.000Z'),
      activeRequests: 3,
      messagesReceivedTotal: 120,
      heapAllocBytes: 64 * 1024 * 1024,
      heapSysBytes: 128 * 1024 * 1024,
      goroutines: 42,
      dbOpenConnections: 8,
    },
    {
      serverId: 'ingest-b',
      observedAt: new Date('2026-04-28T11:52:00.000Z'),
      activeRequests: 1,
      messagesReceivedTotal: 40,
      heapAllocBytes: 16 * 1024 * 1024,
      heapSysBytes: 32 * 1024 * 1024,
      goroutines: 11,
      dbOpenConnections: 2,
    },
  ]
  const history = [
    { serverId: 'ingest-a', observedAt: new Date('2026-04-28T11:00:00.000Z'), messagesReceivedTotal: 70 },
    { serverId: 'ingest-a', observedAt: new Date('2026-04-28T11:59:30.000Z'), messagesReceivedTotal: 120 },
    { serverId: 'ingest-b', observedAt: new Date('2026-04-28T11:00:00.000Z'), messagesReceivedTotal: 25 },
    { serverId: 'ingest-b', observedAt: new Date('2026-04-28T11:52:00.000Z'), messagesReceivedTotal: 40 },
  ]

  const summary = calculateIngestHealthSummary(snapshots, history, now)

  assert.equal(summary.onlineServers, 1)
  assert.equal(summary.totalServers, 2)
  assert.equal(summary.messagesProcessing, 4)
  assert.equal(summary.messagesReceivedLastHour, 65)
  assert.equal(summary.heapAllocBytes, 80 * 1024 * 1024)
  assert.equal(summary.heapSysBytes, 160 * 1024 * 1024)
  assert.equal(summary.goroutines, 53)
  assert.equal(summary.dbOpenConnections, 10)
})
