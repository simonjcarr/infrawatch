import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { validateLicenceKey } from '@/lib/licence'
import {
  hasFeature,
  type Feature,
  type LicenceTier,
  COMMUNITY_MAX_RETENTION_DAYS,
} from '@/lib/features'

export class LicenceRequiredError extends Error {
  constructor(
    public feature: Feature,
    public tier: LicenceTier,
    message: string,
  ) {
    super(message)
    this.name = 'LicenceRequiredError'
  }
}

export type EffectiveLicence = {
  tier: LicenceTier
  features: Feature[]
  maxHosts?: number
  licenceId?: string
  expiresAt?: Date
}

// Cached per-request so multiple requireFeature() calls in one server action
// don't re-validate the JWT repeatedly.
const loadEffectiveLicence = cache(async (orgId: string): Promise<EffectiveLicence> => {
  const [org] = await db
    .select({
      licenceTier: organisations.licenceTier,
      licenceKey: organisations.licenceKey,
    })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .limit(1)

  if (!org) {
    return { tier: 'community', features: [] }
  }

  if (!org.licenceKey) {
    return { tier: 'community', features: [] }
  }

  const result = await validateLicenceKey(org.licenceKey)
  if (!result.valid) {
    // Invalid or expired keys silently degrade to community. The licenceTier
    // column still reflects what was last saved; the guard trusts only the
    // validated JWT, not the cached column.
    return { tier: 'community', features: [] }
  }

  if (result.payload.sub !== orgId) {
    // Key belongs to a different organisation — reject it entirely.
    return { tier: 'community', features: [] }
  }

  return {
    tier: result.payload.tier,
    features: result.payload.features,
    maxHosts: result.payload.maxHosts,
    licenceId: result.payload.jti,
    expiresAt: new Date(result.payload.exp * 1000),
  }
})

export async function getEffectiveLicence(orgId: string): Promise<EffectiveLicence> {
  return loadEffectiveLicence(orgId)
}

export async function hasLicenceFeature(orgId: string, feature: Feature): Promise<boolean> {
  const licence = await loadEffectiveLicence(orgId)
  if (hasFeature(licence.tier, feature)) return true
  if (licence.features.includes(feature)) return true
  return false
}

export async function requireFeature(orgId: string, feature: Feature): Promise<void> {
  const licence = await loadEffectiveLicence(orgId)
  if (hasFeature(licence.tier, feature)) return
  if (licence.features.includes(feature)) return
  throw new LicenceRequiredError(
    feature,
    licence.tier,
    `Feature '${feature}' requires a higher licence tier (current: ${licence.tier})`,
  )
}

export async function clampRetentionDays(orgId: string, days: number): Promise<number> {
  const extended = await hasLicenceFeature(orgId, 'metricRetentionExtended')
  if (extended) return days
  return Math.min(days, COMMUNITY_MAX_RETENTION_DAYS)
}
