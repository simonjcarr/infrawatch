import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { ApiAuthError, getApiInstanceSession } from '@/lib/auth/session'
import { requireToolingAccess } from '@/lib/auth/tooling'
import { db } from '@/lib/db'
import { instanceSettings } from '@/lib/db/schema'
import { logError } from '@/lib/logging'
import {
  getPasswordManagerLaunchAssertionConfig,
  signPasswordManagerLaunchAssertion,
} from '@/lib/password-manager/launch-assertion'
import { createRateLimiter } from '@/lib/rate-limit'
import { assertTrustedMutationOrigin } from '@/lib/security/trusted-origins'

const launchAssertionRateLimit = createRateLimiter({
  scope: 'password-manager:launch-assertion',
  windowMs: 60_000,
  max: 30,
})

function isLaunchConfigError(error: Error): boolean {
  return /^(PASSWORD_MANAGER_CT_OPS_|CT_OPS_INSTANCE_ID|BETTER_AUTH_URL)\b/.test(error.message)
}

async function findInstanceName(instanceId: string): Promise<string | null> {
  const instance = await db.query.instanceSettings.findFirst({
    columns: { name: true },
    where: eq(instanceSettings.id, instanceId),
  })

  return instance?.name ?? null
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let session
  try {
    session = await getApiInstanceSession(request.headers)
    requireToolingAccess(session.user)
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error && error.message === 'forbidden: tooling role required') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    throw error
  }

  const rateLimitKey = `${session.user.instanceId}:${session.user.id}`
  if (!await launchAssertionRateLimit.check(rateLimitKey)) {
    return NextResponse.json(
      { error: 'Too many requests — please wait before trying again.' },
      { status: 429 },
    )
  }

  try {
    const config = getPasswordManagerLaunchAssertionConfig()
    const instanceName = await findInstanceName(session.user.instanceId)
    const assertion = await signPasswordManagerLaunchAssertion(
      {
        instanceId: session.user.instanceId,
        instanceName,
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
      { config },
    )

    return NextResponse.json(
      { assertion },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    )
  } catch (error) {
    logError('[password-manager] failed to mint launch assertion', error, {
      instanceId: session.user.instanceId,
      userId: session.user.id,
    })

    if (error instanceof Error && isLaunchConfigError(error)) {
      return NextResponse.json(
        { error: 'Password Manager launch is not configured.' },
        { status: 503 },
      )
    }

    return NextResponse.json(
      { error: 'Unable to create a Password Manager launch assertion.' },
      { status: 500 },
    )
  }
}
