import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { instanceSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requireInstanceAccess } from '@/lib/actions/action-auth'
import { validateLicenceKey } from '@/lib/licence'
import { hasFeature, type Feature, type LicenceTier } from '@/lib/features'
import { createCommunityLicence } from '@/lib/standalone-empty-state'
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
const loadEffectiveLicence = cache(async (instanceId: string): Promise<EffectiveLicence> => {
  const org = await db.query.instanceSettings.findFirst({
    columns: {
      licenceTier: true,
      licenceKey: true,
      licenceVerifierPublicKey: true,
    },
    where: eq(instanceSettings.id, instanceId),
  })

  if (!org) {
    return getCommunityLicence()
  }

  if (!org.licenceKey) {
    return getCommunityLicence()
  }

  const result = await validateLicenceKey(org.licenceKey, {
    publicKeyPem: org.licenceVerifierPublicKey ?? undefined,
  })
  if (!result.valid) {
    // Invalid or expired keys silently degrade to community. The licenceTier
    // column still reflects what was last saved; the guard trusts only the
    // validated JWT, not the cached column.
    return getCommunityLicence()
  }

  if (result.payload.sub !== instanceId) {
    // Key belongs to a different instance — reject it entirely.
    return getCommunityLicence()
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

function getCommunityLicence(): EffectiveLicence {
  return createCommunityLicence()
}

export async function getInstanceEffectiveLicence(
  scopeId: string | null | undefined,
): Promise<EffectiveLicence> {
  if (!scopeId) return getCommunityLicence()
  return getEffectiveLicence(scopeId)
}

export async function getEffectiveLicence(instanceId: string): Promise<EffectiveLicence> {
  await requireInstanceAccess(instanceId)
  return loadEffectiveLicence(instanceId)
}

export async function getTrustedEffectiveLicence(instanceId: string): Promise<EffectiveLicence> {
  return loadEffectiveLicence(instanceId)
}

export async function hasLicenceFeature(instanceId: string, feature: Feature): Promise<boolean> {
  await requireInstanceAccess(instanceId)
  const licence = await loadEffectiveLicence(instanceId)
  if (hasFeature(licence.tier, feature)) return true
  if (licence.features.includes(feature)) return true
  return false
}

export async function requireFeature(instanceId: string, feature: Feature): Promise<void> {
  await requireInstanceAccess(instanceId)
  const licence = await loadEffectiveLicence(instanceId)
  if (hasFeature(licence.tier, feature)) return
  if (licence.features.includes(feature)) return
  throw new LicenceRequiredError(
    feature,
    licence.tier,
    `Feature '${feature}' requires a higher licence tier (current: ${licence.tier})`,
  )
}
