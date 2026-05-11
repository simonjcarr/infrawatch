export const FEATURE_FLAG_REGISTRY = {
  'automation.ansible': {
    defaultEnabled: false,
    public: true,
    adminConfigurable: true,
    description: 'Enable Ansible automation settings and service integration.',
  },
} as const

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_REGISTRY
export type FeatureFlagOverrides = Partial<Record<FeatureFlagKey, boolean>>

export interface PublicFeatureFlag {
  enabled: boolean
  adminConfigurable: boolean
  description: string
}

export function isKnownFeatureFlag(key: string): key is FeatureFlagKey {
  return Object.hasOwn(FEATURE_FLAG_REGISTRY, key)
}

export function isAdminConfigurableFeatureFlag(key: string): key is FeatureFlagKey {
  return isKnownFeatureFlag(key) && FEATURE_FLAG_REGISTRY[key].adminConfigurable
}

export function normaliseFeatureFlagOverrides(input: unknown): FeatureFlagOverrides {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}

  const overrides: FeatureFlagOverrides = {}
  for (const [key, value] of Object.entries(input)) {
    if (isKnownFeatureFlag(key) && typeof value === 'boolean') {
      overrides[key] = value
    }
  }
  return overrides
}

export function resolveFeatureFlag(key: string, overrides: unknown): boolean {
  if (!isKnownFeatureFlag(key)) return false

  const normalised = normaliseFeatureFlagOverrides(overrides)
  const override = normalised[key]
  if (typeof override === 'boolean') return override

  return FEATURE_FLAG_REGISTRY[key].defaultEnabled
}

export function serialisePublicFeatureFlags(overrides: unknown): Record<string, PublicFeatureFlag> {
  const result: Record<string, PublicFeatureFlag> = {}

  for (const [key, definition] of Object.entries(FEATURE_FLAG_REGISTRY)) {
    if (!definition.public) continue
    result[key] = {
      enabled: resolveFeatureFlag(key, overrides),
      adminConfigurable: definition.adminConfigurable,
      description: definition.description,
    }
  }

  return result
}
