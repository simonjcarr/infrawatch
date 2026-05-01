export type HostVulnerabilityAssessmentStatus = 'affected' | 'clear' | 'stale' | 'not_assessed'

export interface HostVulnerabilityAssessmentInput {
  openConfirmedFindings: number
  lastInventoryScanAt: Date | null
  lastFindingImportAt: Date | null
  now?: Date
  scanStaleAfterMs?: number
  findingImportStaleAfterMs?: number
}

export interface HostVulnerabilityAssessmentStatusResult {
  status: HostVulnerabilityAssessmentStatus
  reason: string
  inventoryStale: boolean
  findingImportStale: boolean
}

const DEFAULT_SCAN_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_FINDING_IMPORT_STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000

export function deriveHostVulnerabilityAssessmentStatus(
  input: HostVulnerabilityAssessmentInput,
): HostVulnerabilityAssessmentStatusResult {
  const now = input.now ?? new Date()
  const scanStaleAfterMs = input.scanStaleAfterMs ?? DEFAULT_SCAN_STALE_AFTER_MS
  const findingImportStaleAfterMs = input.findingImportStaleAfterMs ?? DEFAULT_FINDING_IMPORT_STALE_AFTER_MS

  if (!input.lastInventoryScanAt) {
    return {
      status: 'not_assessed',
      reason: 'No successful software inventory scan has completed for this host.',
      inventoryStale: false,
      findingImportStale: false,
    }
  }

  if (!input.lastFindingImportAt) {
    return {
      status: 'not_assessed',
      reason: 'CT-CVE has not imported vulnerability findings into CT Ops yet.',
      inventoryStale: false,
      findingImportStale: false,
    }
  }

  const inventoryStale = now.getTime() - input.lastInventoryScanAt.getTime() > scanStaleAfterMs
  const findingImportStale = now.getTime() - input.lastFindingImportAt.getTime() > findingImportStaleAfterMs

  if (input.openConfirmedFindings > 0) {
    return {
      status: 'affected',
      reason: 'Confirmed Linux package CVE findings are open for this host.',
      inventoryStale,
      findingImportStale,
    }
  }

  if (inventoryStale || findingImportStale) {
    return {
      status: 'stale',
      reason: inventoryStale
        ? 'The last software inventory scan is stale.'
        : 'The last CT-CVE finding import is stale.',
      inventoryStale,
      findingImportStale,
    }
  }

  return {
    status: 'clear',
    reason: 'No confirmed Linux package CVE findings are open for the latest assessed inventory.',
    inventoryStale,
    findingImportStale,
  }
}
