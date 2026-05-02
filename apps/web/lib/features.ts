const FEATURE_TIERS = {
  // Core CT Ops features are available in Community. Paid seats only add capacity.
  ssoOidc: ['community', 'enterprise'],
  auditLog: ['community', 'enterprise'],
  certExpiryTracker: ['community', 'enterprise'],
  serviceAccountTracker: ['community', 'enterprise'],
  reportsExport: ['community', 'enterprise'],
  reportsScheduled: ['community', 'enterprise'],
  metricRetentionExtended: ['community', 'enterprise'],
  scheduledTasks: ['community', 'enterprise'],
  alertRouting: ['community', 'enterprise'],
  csrInternalCa: ['community', 'enterprise'],
  sshKeyInventory: ['community', 'enterprise'],

  // Tier 2 (Enterprise) only
  ssoSaml: ['enterprise'],
  advancedRbac: ['enterprise'],
  whiteLabel: ['enterprise'],
  compliancePack: ['enterprise'],
  airgapBundlers: ['enterprise'],
  haDeployment: ['enterprise'],
} as const

export type Feature = keyof typeof FEATURE_TIERS
export type LicenceTier = 'community' | 'enterprise'

export function hasFeature(tier: LicenceTier, feature: Feature): boolean {
  return (FEATURE_TIERS[feature] as readonly string[]).includes(tier)
}

export function featuresForTier(tier: LicenceTier): Feature[] {
  return (Object.keys(FEATURE_TIERS) as Feature[]).filter((f) => hasFeature(tier, f))
}
