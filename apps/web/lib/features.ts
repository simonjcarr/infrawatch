const FEATURE_TIERS = {
  // Core CT Ops features are available in Community. Pro is a seat-capacity tier.
  ssoOidc: ['community', 'pro', 'enterprise'],
  auditLog: ['community', 'pro', 'enterprise'],
  certExpiryTracker: ['community', 'pro', 'enterprise'],
  serviceAccountTracker: ['community', 'pro', 'enterprise'],
  reportsExport: ['community', 'pro', 'enterprise'],
  reportsScheduled: ['community', 'pro', 'enterprise'],
  metricRetentionExtended: ['community', 'pro', 'enterprise'],
  scheduledTasks: ['community', 'pro', 'enterprise'],
  alertRouting: ['community', 'pro', 'enterprise'],
  csrInternalCa: ['community', 'pro', 'enterprise'],
  sshKeyInventory: ['community', 'pro', 'enterprise'],

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

export function hasFeature(tier: LicenceTier, feature: Feature): boolean {
  return (FEATURE_TIERS[feature] as readonly string[]).includes(tier)
}

export function featuresForTier(tier: LicenceTier): Feature[] {
  return (Object.keys(FEATURE_TIERS) as Feature[]).filter((f) => hasFeature(tier, f))
}
