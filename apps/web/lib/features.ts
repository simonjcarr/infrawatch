const FEATURE_TIERS = {
  // Tier 1 (Pro) + Tier 2 (Enterprise)
  ssoOidc: ['pro', 'enterprise'],
  auditLog: ['pro', 'enterprise'],
  certExpiryTracker: ['pro', 'enterprise'],
  serviceAccountTracker: ['pro', 'enterprise'],
  reportsExport: ['pro', 'enterprise'],
  reportsScheduled: ['pro', 'enterprise'],
  metricRetentionExtended: ['pro', 'enterprise'],
  scheduledTasks: ['pro', 'enterprise'],
  alertRouting: ['pro', 'enterprise'],
  csrInternalCa: ['pro', 'enterprise'],
  sshKeyInventory: ['pro', 'enterprise'],

  // Tier 2 (Enterprise) only
  ssoSaml: ['enterprise'],
  advancedRbac: ['enterprise'],
  whiteLabel: ['enterprise'],
  compliancePack: ['enterprise'],
  airgapBundlers: ['enterprise'],
  haDeployment: ['enterprise'],
} as const

export type Feature = keyof typeof FEATURE_TIERS
export type LicenceTier = 'community' | 'pro' | 'enterprise'

export const COMMUNITY_MAX_RETENTION_DAYS = 180

export function hasFeature(tier: LicenceTier, feature: Feature): boolean {
  return (FEATURE_TIERS[feature] as readonly string[]).includes(tier)
}

export function featuresForTier(tier: LicenceTier): Feature[] {
  return (Object.keys(FEATURE_TIERS) as Feature[]).filter((f) => hasFeature(tier, f))
}
