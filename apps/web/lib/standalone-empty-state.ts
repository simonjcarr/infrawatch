import type { CertificateCounts } from '@/lib/actions/certificates'
import type { DomainAccountCounts } from '@/lib/actions/domain-accounts'
import type { PatchManagementReport } from '@/lib/actions/patch-status'
import type { EffectiveLicence } from '@/lib/actions/licence-guard'
import type { CtCveConnectorSetupOverview } from '@/lib/integrations/ct-cve/setup-status'
import { featuresForTier } from '@/lib/features'
import { FREE_INCLUDED_USER_SEATS } from '@/lib/licence-seats'

export const EMPTY_CERTIFICATE_COUNTS: CertificateCounts = {
  valid: 0,
  expiringSoon: 0,
  expired: 0,
  invalid: 0,
}

export const EMPTY_DOMAIN_ACCOUNT_COUNTS: DomainAccountCounts = {
  total: 0,
  active: 0,
  disabled: 0,
  locked: 0,
  expired: 0,
}

export function createEmptyPatchManagementReport(): PatchManagementReport {
  return {
    generatedAt: new Date(),
    summary: {
      totalHosts: 0,
      passingCount: 0,
      failingCount: 0,
      errorCount: 0,
      unknownCount: 0,
      averagePatchAgeDays: null,
      oldestPatchAgeDays: null,
      totalAvailableUpdates: 0,
    },
    networks: [],
    hosts: [],
  }
}

export function createCommunityLicence(): EffectiveLicence {
  return {
    tier: 'community',
    features: featuresForTier('community'),
    maxUsers: FREE_INCLUDED_USER_SEATS,
  }
}

export function createEmptyCtCveConnectorSetupOverview(instanceId = ''): CtCveConnectorSetupOverview {
  return {
    configured: false,
    enabled: false,
    inbound: {
      configured: false,
      tokenCount: 0,
      revokedTokenCount: 0,
      scopes: [],
      error: null,
    },
    inventoryPush: {
      configured: false,
      targetCount: 0,
      targets: [],
      error: null,
    },
    status: {
      contractVersion: '2026-04-30',
      instanceId,
      configured: false,
      enabled: false,
      lastInventoryPushAt: null,
      lastFindingIngestAt: null,
      lastHealthCheckAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
    },
  }
}
