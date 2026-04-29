export type HostVulnerabilityAssessmentStatus = 'affected' | 'clear' | 'stale' | 'not_assessed'

export interface HostVulnerabilityAssessmentInput {
  openConfirmedFindings: number
  lastInventoryScanAt: Date | null
  lastFeedSyncAt: Date | null
  now?: Date
  scanStaleAfterMs?: number
  feedStaleAfterMs?: number
}

export interface HostVulnerabilityAssessmentStatusResult {
  status: HostVulnerabilityAssessmentStatus
  reason: string
  inventoryStale: boolean
  feedStale: boolean
}

const DEFAULT_SCAN_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_FEED_STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000

export function deriveHostVulnerabilityAssessmentStatus(
  input: HostVulnerabilityAssessmentInput,
): HostVulnerabilityAssessmentStatusResult {
  const now = input.now ?? new Date()
  const scanStaleAfterMs = input.scanStaleAfterMs ?? DEFAULT_SCAN_STALE_AFTER_MS
  const feedStaleAfterMs = input.feedStaleAfterMs ?? DEFAULT_FEED_STALE_AFTER_MS

  if (!input.lastInventoryScanAt) {
    return {
      status: 'not_assessed',
      reason: 'No successful software inventory scan has completed for this host.',
      inventoryStale: false,
      feedStale: false,
    }
  }

  if (!input.lastFeedSyncAt) {
    return {
      status: 'not_assessed',
      reason: 'Vulnerability feeds have not completed a successful sync yet.',
      inventoryStale: false,
      feedStale: false,
    }
  }

  const inventoryStale = now.getTime() - input.lastInventoryScanAt.getTime() > scanStaleAfterMs
  const feedStale = now.getTime() - input.lastFeedSyncAt.getTime() > feedStaleAfterMs

  if (input.openConfirmedFindings > 0) {
    return {
      status: 'affected',
      reason: 'Confirmed Linux package CVE findings are open for this host.',
      inventoryStale,
      feedStale,
    }
  }

  if (inventoryStale || feedStale) {
    return {
      status: 'stale',
      reason: inventoryStale
        ? 'The last software inventory scan is stale.'
        : 'The vulnerability feed data is stale.',
      inventoryStale,
      feedStale,
    }
  }

  return {
    status: 'clear',
    reason: 'No confirmed Linux package CVE findings are open for the latest assessed inventory.',
    inventoryStale,
    feedStale,
  }
}
