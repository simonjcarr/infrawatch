import { NextResponse } from 'next/server'

import { resolveCurrentActionScope } from '@/lib/actions/action-scope'
import { getRequiredSession } from '@/lib/auth/session'
import { getPublicFeatureFlagsForInstance } from '@/lib/feature-flags-db'

export async function GET() {
  const session = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(session)
  const features = await getPublicFeatureFlagsForInstance(instanceId)

  return NextResponse.json({ features })
}
