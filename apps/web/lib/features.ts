const FEATURE_TIERS = {
  sso: ['pro', 'enterprise'],
  auditLog: ['pro', 'enterprise'],
  advancedRbac: ['pro', 'enterprise'],
  whiteLabel: ['enterprise'],
  compliancePack: ['enterprise'],
} as const

export type Feature = keyof typeof FEATURE_TIERS
export type LicenceTier = 'community' | 'pro' | 'enterprise'

export function hasFeature(tier: LicenceTier, feature: Feature): boolean {
  return (FEATURE_TIERS[feature] as readonly string[]).includes(tier)
}
