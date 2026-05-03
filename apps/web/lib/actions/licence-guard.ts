import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requireOrgAccess } from '@/lib/actions/action-auth'
import { validateLicenceKey } from '@/lib/licence'
import { featuresForTier, hasFeature, type Feature, type LicenceTier } from '@/lib/features'
import { FREE_INCLUDED_USER_SEATS } from '@/lib/licence-seats'

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
  maxUsers?: number
  maxHosts?: number
  licenceId?: string
  expiresAt?: Date
}

// Cached per-request so multiple requireFeature() calls in one server action
// don't re-validate the JWT repeatedly.
const loadEffectiveLicence = cache(async (orgId: string): Promise<EffectiveLicence> => {
  const org = await db.query.organisations.findFirst({
    columns: {
      licenceTier: true,
      licenceKey: true,
      licenceVerifierPublicKey: true,
    },
    where: eq(organisations.id, orgId),
  })

  if (!org) {
    return { tier: 'community', features: featuresForTier('community'), maxUsers: FREE_INCLUDED_USER_SEATS }
  }

  if (!org.licenceKey) {
    return { tier: 'community', features: featuresForTier('community'), maxUsers: FREE_INCLUDED_USER_SEATS }
  }

  const result = await validateLicenceKey(org.licenceKey, {
    publicKeyPem: org.licenceVerifierPublicKey ?? undefined,
  })
  if (!result.valid) {
    // Invalid or expired keys silently degrade to community. The licenceTier
    // column still reflects what was last saved; the guard trusts only the
    // validated JWT, not the cached column.
    return { tier: 'community', features: featuresForTier('community'), maxUsers: FREE_INCLUDED_USER_SEATS }
  }

  if (result.payload.sub !== orgId) {
    // Key belongs to a different organisation — reject it entirely.
    return { tier: 'community', features: featuresForTier('community'), maxUsers: FREE_INCLUDED_USER_SEATS }
  }

  return {
    tier: result.payload.tier,
    features: result.payload.features,
    maxUsers: result.payload.maxUsers ?? FREE_INCLUDED_USER_SEATS,
    maxHosts: result.payload.maxHosts,
    licenceId: result.payload.jti,
    expiresAt: new Date(result.payload.exp * 1000),
  }
})

export async function getEffectiveLicence(orgId: string): Promise<EffectiveLicence> {
  await requireOrgAccess(orgId)
  return loadEffectiveLicence(orgId)
}

export async function getTrustedEffectiveLicence(orgId: string): Promise<EffectiveLicence> {
  return loadEffectiveLicence(orgId)
}

export async function hasLicenceFeature(orgId: string, feature: Feature): Promise<boolean> {
  await requireOrgAccess(orgId)
  const licence = await loadEffectiveLicence(orgId)
  if (hasFeature(licence.tier, feature)) return true
  if (licence.features.includes(feature)) return true
  return false
}

export async function requireFeature(orgId: string, feature: Feature): Promise<void> {
  await requireOrgAccess(orgId)
  const licence = await loadEffectiveLicence(orgId)
  if (hasFeature(licence.tier, feature)) return
  if (licence.features.includes(feature)) return
  throw new LicenceRequiredError(
    feature,
    licence.tier,
    `Feature '${feature}' requires a higher licence tier (current: ${licence.tier})`,
  )
}
