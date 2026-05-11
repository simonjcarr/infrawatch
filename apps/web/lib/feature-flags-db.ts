import 'server-only'

import { eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { instanceSettings, parseInstanceMetadata } from '@/lib/db/schema'
import {
  resolveFeatureFlag,
  serialisePublicFeatureFlags,
  type FeatureFlagKey,
} from '@/lib/feature-flags'

export async function isFeatureFlagEnabled(instanceId: string, key: FeatureFlagKey): Promise<boolean> {
  const row = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })

  return resolveFeatureFlag(key, parseInstanceMetadata(row?.metadata).featureFlags)
}

export async function requireFeatureFlag(instanceId: string, key: FeatureFlagKey): Promise<void> {
  if (await isFeatureFlagEnabled(instanceId, key)) return
  throw new Error(`Feature flag '${key}' is disabled`)
}

export async function getPublicFeatureFlagsForInstance(instanceId: string) {
  const row = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })

  return serialisePublicFeatureFlags(parseInstanceMetadata(row?.metadata).featureFlags)
}
