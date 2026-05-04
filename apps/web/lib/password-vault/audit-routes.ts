import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { ZodError } from 'zod'
import { writeAuditEvent } from '@/lib/audit/events'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'
import { type TransactionDatabase, withOrgDatabaseScope } from '@/lib/db'
import {
  passwordVaultEntries,
  passwordVaultMembers,
  passwordVaults,
} from '@/lib/db/schema'
import { createRateLimiter } from '@/lib/rate-limit'
import { assertTrustedMutationOrigin } from '@/lib/security/trusted-origins'
import {
  PASSWORD_VAULT_API_RATE_LIMITS,
  assertPasswordVaultMutationBodySize,
} from './api-policy.ts'
import {
  buildPasswordVaultAuditEvent,
  createPasswordVaultAuditResponse,
  parsePasswordVaultUnlockAuditPayload,
} from './audit-api.ts'

type PasswordVaultOrgSession = Awaited<ReturnType<typeof getApiOrgSession>>

const sensitiveAuditRateLimiter = createRateLimiter(PASSWORD_VAULT_API_RATE_LIMITS.sensitiveAudit)

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ message }, { status })
}

function getRateLimitKey(request: NextRequest, session: PasswordVaultOrgSession): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const clientIp = forwardedFor || request.headers.get('x-real-ip') || session.session.ipAddress || 'unknown'
  return `${session.user.organisationId}:${session.user.id}:${clientIp}`
}

async function readOptionalJsonMutationBody(request: NextRequest): Promise<unknown> {
  const raw = await request.text()
  assertPasswordVaultMutationBodySize(new TextEncoder().encode(raw).byteLength)

  if (!raw.trim()) {
    return {}
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error('invalid-json')
  }
}

function handlePasswordVaultAuditRouteError(error: unknown): NextResponse {
  if (error instanceof ApiAuthError) {
    return jsonError(error.message, error.status)
  }

  if (error instanceof ZodError || error instanceof SyntaxError || error instanceof TypeError) {
    return jsonError('Invalid Password Vault audit payload.', 400)
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

  return jsonError('Password Vault audit request failed.', 500)
}

async function hasActiveVaultMembership(
  scopedDb: TransactionDatabase,
  session: PasswordVaultOrgSession,
  vaultId: string,
): Promise<boolean> {
  const [row] = await scopedDb
    .select({ vaultId: passwordVaultMembers.vaultId })
    .from(passwordVaultMembers)
    .innerJoin(passwordVaults, eq(passwordVaultMembers.vaultId, passwordVaults.id))
    .where(and(
      eq(passwordVaultMembers.organisationId, session.user.organisationId),
      eq(passwordVaultMembers.userId, session.user.id),
      eq(passwordVaultMembers.vaultId, vaultId),
      isNull(passwordVaultMembers.revokedAt),
      eq(passwordVaults.organisationId, session.user.organisationId),
      isNull(passwordVaults.deletedAt),
    ))
    .limit(1)

  return Boolean(row)
}

async function hasAccessibleEntry(
  scopedDb: TransactionDatabase,
  session: PasswordVaultOrgSession,
  vaultId: string,
  entryId: string,
): Promise<boolean> {
  if (!await hasActiveVaultMembership(scopedDb, session, vaultId)) {
    return false
  }

  const [entry] = await scopedDb
    .select({ id: passwordVaultEntries.id })
    .from(passwordVaultEntries)
    .where(and(
      eq(passwordVaultEntries.id, entryId),
      eq(passwordVaultEntries.organisationId, session.user.organisationId),
      eq(passwordVaultEntries.vaultId, vaultId),
      isNull(passwordVaultEntries.deletedAt),
    ))
    .limit(1)

  return Boolean(entry)
}

async function assertSensitiveAuditAllowed(
  request: NextRequest,
  session: PasswordVaultOrgSession,
): Promise<boolean> {
  return sensitiveAuditRateLimiter.check(getRateLimitKey(request, session))
}

export async function recordPasswordVaultUnlockAudit(request: NextRequest): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    if (!await assertSensitiveAuditAllowed(request, session)) {
      return jsonError('Too many Password Vault audit requests.', 429)
    }

    const payload = parsePasswordVaultUnlockAuditPayload(await readOptionalJsonMutationBody(request))
    await withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
      await writeAuditEvent(scopedDb, buildPasswordVaultAuditEvent({
        organisationId: session.user.organisationId,
        actorUserId: session.user.id,
        event: payload.result === 'success' ? 'unlock_succeeded' : 'unlock_failed',
      }))
    })

    return NextResponse.json(createPasswordVaultAuditResponse(), { status: 201 })
  } catch (error) {
    return handlePasswordVaultAuditRouteError(error)
  }
}

export async function recordPasswordVaultEntryRevealAudit(
  request: NextRequest,
  vaultId: string,
  entryId: string,
): Promise<NextResponse> {
  return recordPasswordVaultEntrySensitiveAudit(request, vaultId, entryId, 'entry_revealed')
}

export async function recordPasswordVaultEntryCopyAudit(
  request: NextRequest,
  vaultId: string,
  entryId: string,
): Promise<NextResponse> {
  return recordPasswordVaultEntrySensitiveAudit(request, vaultId, entryId, 'entry_copied')
}

async function recordPasswordVaultEntrySensitiveAudit(
  request: NextRequest,
  vaultId: string,
  entryId: string,
  event: 'entry_revealed' | 'entry_copied',
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    if (!await assertSensitiveAuditAllowed(request, session)) {
      return jsonError('Too many Password Vault audit requests.', 429)
    }
    await readOptionalJsonMutationBody(request)

    const recorded = await withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
      if (!await hasAccessibleEntry(scopedDb, session, vaultId, entryId)) {
        return false
      }

      await writeAuditEvent(scopedDb, buildPasswordVaultAuditEvent({
        organisationId: session.user.organisationId,
        actorUserId: session.user.id,
        event,
        vaultId,
        entryId,
      }))

      return true
    })

    if (!recorded) {
      return jsonError('Password Vault entry not found.', 404)
    }

    return NextResponse.json(createPasswordVaultAuditResponse(), { status: 201 })
  } catch (error) {
    return handlePasswordVaultAuditRouteError(error)
  }
}

export async function recordPasswordVaultExportAudit(
  request: NextRequest,
  vaultId: string,
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    if (!await assertSensitiveAuditAllowed(request, session)) {
      return jsonError('Too many Password Vault audit requests.', 429)
    }
    await readOptionalJsonMutationBody(request)

    const recorded = await withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
      if (!await hasActiveVaultMembership(scopedDb, session, vaultId)) {
        return false
      }

      await writeAuditEvent(scopedDb, buildPasswordVaultAuditEvent({
        organisationId: session.user.organisationId,
        actorUserId: session.user.id,
        event: 'vault_exported',
        vaultId,
      }))

      return true
    })

    if (!recorded) {
      return jsonError('Password Vault not found.', 404)
    }

    return NextResponse.json(createPasswordVaultAuditResponse(), { status: 201 })
  } catch (error) {
    return handlePasswordVaultAuditRouteError(error)
  }
}
