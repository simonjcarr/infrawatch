import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { ZodError } from 'zod'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'
import { writeAuditEvent } from '@/lib/audit/events'
import { withOrgDatabaseScope } from '@/lib/db'
import { passwordVaultUserKeys } from '@/lib/db/schema'
import type { PasswordVaultUserKey } from '@/lib/db/schema/password-vault.ts'
import { createRateLimiter } from '@/lib/rate-limit'
import { assertTrustedMutationOrigin } from '@/lib/security/trusted-origins'
import {
  PASSWORD_VAULT_API_RATE_LIMITS,
  assertPasswordVaultMutationBodySize,
  assertPasswordVaultReadBodySize,
} from './api-policy.ts'
import { buildPasswordVaultAuditEvent } from './audit-api.ts'
import {
  createPasswordVaultSetupStatus,
  createPasswordVaultUserKeyConflictResponse,
  parsePasswordVaultUserKeyPayload,
  serializePasswordVaultUserKey,
} from './profile-api.ts'

const setupRateLimiter = createRateLimiter(PASSWORD_VAULT_API_RATE_LIMITS.setup)
const unlockRateLimiter = createRateLimiter(PASSWORD_VAULT_API_RATE_LIMITS.unlock)

type PasswordVaultOrgSession = Awaited<ReturnType<typeof getApiOrgSession>>

async function findUserKey(session: PasswordVaultOrgSession): Promise<PasswordVaultUserKey | null> {
  const userKey = await withOrgDatabaseScope(session.user.organisationId, (scopedDb) => scopedDb.query.passwordVaultUserKeys.findFirst({
    where: eq(passwordVaultUserKeys.userId, session.user.id),
  }))

  return userKey ?? null
}

async function createUserKey(
  session: PasswordVaultOrgSession,
  payload: ReturnType<typeof parsePasswordVaultUserKeyPayload>,
): Promise<PasswordVaultUserKey | null> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    const now = new Date()
    const [created] = await scopedDb
      .insert(passwordVaultUserKeys)
      .values({
        userId: session.user.id,
        publicKey: payload.publicKey,
        encryptedPrivateKeyEnvelope: payload.encryptedPrivateKeyEnvelope,
        kdfParams: payload.kdfParams,
        envelopeVersion: payload.envelopeVersion,
        createdAt: now,
        updatedAt: now,
        setupCompletedAt: now,
      })
      .onConflictDoNothing({ target: passwordVaultUserKeys.userId })
      .returning()

    if (!created) {
      return null
    }

    await writeAuditEvent(scopedDb, buildPasswordVaultAuditEvent({
      organisationId: session.user.organisationId,
      actorUserId: session.user.id,
      event: 'setup_completed',
    }))

    return created
  })
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ message }, { status })
}

function getRateLimitKey(request: NextRequest, session: PasswordVaultOrgSession): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const clientIp = forwardedFor || request.headers.get('x-real-ip') || session.session.ipAddress || 'unknown'
  return `${session.user.organisationId}:${session.user.id}:${clientIp}`
}

function hasRequestBody(request: NextRequest): boolean {
  const contentLength = request.headers.get('content-length')
  return contentLength !== null && contentLength !== '0'
}

async function readJsonMutationBody(request: NextRequest): Promise<unknown> {
  const raw = await request.text()
  assertPasswordVaultMutationBodySize(new TextEncoder().encode(raw).byteLength)

  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error('invalid-json')
  }
}

function handlePasswordVaultRouteError(error: unknown): NextResponse {
  if (error instanceof ApiAuthError) {
    return jsonError(error.message, error.status)
  }

  if (error instanceof ZodError || error instanceof SyntaxError || error instanceof TypeError) {
    return jsonError('Invalid Password Vault profile payload.', 400)
  }

  if (error instanceof Error) {
    if (error.message === 'invalid-json') {
      return jsonError('Invalid request body.', 400)
    }

    if (/payload too large|request body is not allowed/i.test(error.message)) {
      return jsonError(error.message, 413)
    }

    if (/invalid request origin/i.test(error.message)) {
      return jsonError('Forbidden', 403)
    }
  }

  return jsonError('Password Vault profile request failed.', 500)
}

export async function getPasswordVaultSetupStatus(request: NextRequest): Promise<NextResponse> {
  try {
    assertPasswordVaultReadBodySize(hasRequestBody(request) ? 1 : 0)
    const session = await getApiOrgSession(request.headers)
    const userKey = await findUserKey(session)

    return NextResponse.json(createPasswordVaultSetupStatus(userKey))
  } catch (error) {
    return handlePasswordVaultRouteError(error)
  }
}

export async function getPasswordVaultUserKey(request: NextRequest): Promise<NextResponse> {
  try {
    assertPasswordVaultReadBodySize(hasRequestBody(request) ? 1 : 0)
    const session = await getApiOrgSession(request.headers)
    const userKey = await findUserKey(session)

    if (!userKey) {
      return jsonError('Password Vault has not been set up for this user.', 404)
    }

    return NextResponse.json(serializePasswordVaultUserKey(userKey))
  } catch (error) {
    return handlePasswordVaultRouteError(error)
  }
}

export async function putPasswordVaultUserKey(request: NextRequest): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)

    if (!await setupRateLimiter.check(getRateLimitKey(request, session))) {
      return jsonError('Too many Password Vault setup attempts.', 429)
    }

    const payload = parsePasswordVaultUserKeyPayload(await readJsonMutationBody(request))
    const created = await createUserKey(session, payload)

    if (!created) {
      return NextResponse.json(createPasswordVaultUserKeyConflictResponse(), { status: 409 })
    }

    return NextResponse.json(serializePasswordVaultUserKey(created), { status: 201 })
  } catch (error) {
    return handlePasswordVaultRouteError(error)
  }
}

export async function getPasswordVaultUnlockMetadata(request: NextRequest): Promise<NextResponse> {
  try {
    assertPasswordVaultReadBodySize(hasRequestBody(request) ? 1 : 0)
    const session = await getApiOrgSession(request.headers)

    if (!await unlockRateLimiter.check(getRateLimitKey(request, session))) {
      return jsonError('Too many Password Vault unlock metadata requests.', 429)
    }

    const userKey = await findUserKey(session)

    if (!userKey) {
      return jsonError('Password Vault has not been set up for this user.', 404)
    }

    return NextResponse.json(serializePasswordVaultUserKey(userKey))
  } catch (error) {
    return handlePasswordVaultRouteError(error)
  }
}
