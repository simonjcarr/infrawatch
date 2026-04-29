import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveHostVulnerabilityAssessmentStatus } from './assessment.ts'

const now = new Date('2026-04-29T12:00:00.000Z')
const recentInventory = new Date('2026-04-29T10:00:00.000Z')
const recentFeed = new Date('2026-04-29T09:00:00.000Z')

test('host assessment is affected when confirmed findings are open', () => {
  const result = deriveHostVulnerabilityAssessmentStatus({
    openConfirmedFindings: 2,
    lastInventoryScanAt: recentInventory,
    lastFeedSyncAt: recentFeed,
    now,
  })

  assert.equal(result.status, 'affected')
  assert.equal(result.inventoryStale, false)
  assert.equal(result.feedStale, false)
})

test('host assessment is clear when scans are fresh and no confirmed findings are open', () => {
  const result = deriveHostVulnerabilityAssessmentStatus({
    openConfirmedFindings: 0,
    lastInventoryScanAt: recentInventory,
    lastFeedSyncAt: recentFeed,
    now,
  })

  assert.equal(result.status, 'clear')
})

test('host assessment is not assessed without inventory or feed data', () => {
  assert.equal(deriveHostVulnerabilityAssessmentStatus({
    openConfirmedFindings: 0,
    lastInventoryScanAt: null,
    lastFeedSyncAt: recentFeed,
    now,
  }).status, 'not_assessed')

  assert.equal(deriveHostVulnerabilityAssessmentStatus({
    openConfirmedFindings: 0,
    lastInventoryScanAt: recentInventory,
    lastFeedSyncAt: null,
    now,
  }).status, 'not_assessed')
})

test('host assessment is stale when inventory or feed data is too old', () => {
  const staleInventory = deriveHostVulnerabilityAssessmentStatus({
    openConfirmedFindings: 0,
    lastInventoryScanAt: new Date('2026-04-20T12:00:00.000Z'),
    lastFeedSyncAt: recentFeed,
    now,
  })
  assert.equal(staleInventory.status, 'stale')
  assert.equal(staleInventory.inventoryStale, true)

  const staleFeed = deriveHostVulnerabilityAssessmentStatus({
    openConfirmedFindings: 0,
    lastInventoryScanAt: recentInventory,
    lastFeedSyncAt: new Date('2026-04-26T12:00:00.000Z'),
    now,
  })
  assert.equal(staleFeed.status, 'stale')
  assert.equal(staleFeed.feedStale, true)
})
