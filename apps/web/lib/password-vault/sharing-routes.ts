import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { ZodError } from 'zod'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'
import { writeAuditEvent } from '@/lib/audit/events'
import { createRateLimiter } from '@/lib/rate-limit'
import { type TransactionDatabase, withOrgDatabaseScope } from '@/lib/db'
import {
  passwordVaultKeyEpochs,
  passwordVaultMembers,
  passwordVaultUserKeys,
  passwordVaults,
  users,
} from '@/lib/db/schema'
import type {
  PasswordVaultKeyEpoch,
  PasswordVaultMemberRole,
} from '@/lib/db/schema/password-vault.ts'
import { assertTrustedMutationOrigin } from '@/lib/security/trusted-origins'
import {
  PASSWORD_VAULT_API_RATE_LIMITS,
  assertPasswordVaultMutationBodySize,
  assertPasswordVaultReadBodySize,
} from './api-policy.ts'
import { buildPasswordVaultAuditEvent } from './audit-api.ts'
import { PASSWORD_VAULT_KEY_WRAP_VERSION } from './vault-api.ts'
import {
  createPasswordVaultKeyEpochResponse,
  createPasswordVaultMemberDeletedResponse,
  parseAddPasswordVaultMemberPayload,
  parseRotatePasswordVaultKeyEpochPayload,
  parseUpdatePasswordVaultMemberPayload,
  serializePasswordVaultMember,
  willLeaveVaultWithoutOwner,
  type SerializablePasswordVaultMember,
} from './sharing-api.ts'

type PasswordVaultOrgSession = Awaited<ReturnType<typeof getApiOrgSession>>

const MANAGER_ROLES = new Set<PasswordVaultMemberRole>(['owner', 'admin'])
const shareRateLimiter = createRateLimiter(PASSWORD_VAULT_API_RATE_LIMITS.share)

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ message }, { status })
}

function hasRequestBody(request: NextRequest): boolean {
  const contentLength = request.headers.get('content-length')
  return contentLength !== null && contentLength !== '0'
}

function getRateLimitKey(request: NextRequest, session: PasswordVaultOrgSession): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const clientIp = forwardedFor || request.headers.get('x-real-ip') || session.session.ipAddress || 'unknown'
  return `${session.user.organisationId}:${session.user.id}:${clientIp}`
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

function handlePasswordVaultSharingRouteError(error: unknown): NextResponse {
  if (error instanceof ApiAuthError) {
    return jsonError(error.message, error.status)
  }

  if (error instanceof ZodError || error instanceof SyntaxError || error instanceof TypeError) {
    return jsonError('Invalid Password Vault sharing payload.', 400)
  }

  if (error instanceof Error) {
    if (error.message === 'invalid-json') {
      return jsonError('Invalid request body.', 400)
    }

    if (error.message === 'Duplicate Password Vault member key wrap') {
      return jsonError('Invalid Password Vault sharing payload.', 400)
    }

    if (/payload too large|request body is not allowed/i.test(error.message)) {
      return jsonError(error.message, 413)
    }

    if (/invalid request origin/i.test(error.message)) {
      return jsonError('Forbidden', 403)
    }
  }

  return jsonError('Password Vault sharing request failed.', 500)
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message)
  }

  return row
}

function toSerializableMember(row: {
  member: typeof passwordVaultMembers.$inferSelect
  user: typeof users.$inferSelect
  keyEpoch: typeof passwordVaultKeyEpochs.$inferSelect
}): SerializablePasswordVaultMember {
  return {
    userId: row.member.userId,
    name: row.user.name,
    email: row.user.email,
    role: row.member.role,
    keyEpochId: row.member.keyEpochId,
    keyEpochNumber: row.keyEpoch.epochNumber,
    createdAt: row.member.createdAt,
    updatedAt: row.member.updatedAt,
    revokedAt: row.member.revokedAt,
  }
}

async function findActorMembership(
  scopedDb: TransactionDatabase,
  session: PasswordVaultOrgSession,
  vaultId: string,
): Promise<typeof passwordVaultMembers.$inferSelect | null> {
  const [row] = await scopedDb
    .select({ member: passwordVaultMembers })
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

  return row?.member ?? null
}

async function requireManagerMembership(
  scopedDb: TransactionDatabase,
  session: PasswordVaultOrgSession,
  vaultId: string,
): Promise<typeof passwordVaultMembers.$inferSelect | 'not-found' | 'forbidden'> {
  const actorMember = await findActorMembership(scopedDb, session, vaultId)

  if (!actorMember) {
    return 'not-found'
  }

  if (!MANAGER_ROLES.has(actorMember.role)) {
    return 'forbidden'
  }

  return actorMember
}

async function listActiveOwnerUserIds(
  scopedDb: TransactionDatabase,
  organisationId: string,
  vaultId: string,
): Promise<string[]> {
  const rows = await scopedDb
    .select({ userId: passwordVaultMembers.userId })
    .from(passwordVaultMembers)
    .where(and(
      eq(passwordVaultMembers.organisationId, organisationId),
      eq(passwordVaultMembers.vaultId, vaultId),
      eq(passwordVaultMembers.role, 'owner'),
      isNull(passwordVaultMembers.revokedAt),
    ))

  return rows.map((row) => row.userId)
}

async function getCurrentKeyEpoch(
  scopedDb: TransactionDatabase,
  organisationId: string,
  vaultId: string,
): Promise<PasswordVaultKeyEpoch | null> {
  const [epoch] = await scopedDb
    .select()
    .from(passwordVaultKeyEpochs)
    .where(and(
      eq(passwordVaultKeyEpochs.organisationId, organisationId),
      eq(passwordVaultKeyEpochs.vaultId, vaultId),
    ))
    .orderBy(desc(passwordVaultKeyEpochs.epochNumber))
    .limit(1)

  return epoch ?? null
}

async function findSerializableMember(
  scopedDb: TransactionDatabase,
  organisationId: string,
  vaultId: string,
  userId: string,
): Promise<SerializablePasswordVaultMember | null> {
  const [row] = await scopedDb
    .select({
      member: passwordVaultMembers,
      user: users,
      keyEpoch: passwordVaultKeyEpochs,
    })
    .from(passwordVaultMembers)
    .innerJoin(users, eq(passwordVaultMembers.userId, users.id))
    .innerJoin(passwordVaultKeyEpochs, eq(passwordVaultMembers.keyEpochId, passwordVaultKeyEpochs.id))
    .where(and(
      eq(passwordVaultMembers.organisationId, organisationId),
      eq(passwordVaultMembers.vaultId, vaultId),
      eq(passwordVaultMembers.userId, userId),
      isNull(passwordVaultMembers.revokedAt),
      isNull(users.deletedAt),
    ))
    .limit(1)

  return row ? toSerializableMember(row) : null
}

async function assertShareMutationAllowed(
  request: NextRequest,
  session: PasswordVaultOrgSession,
): Promise<boolean> {
  return shareRateLimiter.check(getRateLimitKey(request, session))
}

async function listMembers(
  session: PasswordVaultOrgSession,
  vaultId: string,
): Promise<SerializablePasswordVaultMember[] | 'not-found'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    const actorMember = await findActorMembership(scopedDb, session, vaultId)

    if (!actorMember) {
      return 'not-found'
    }

    const rows = await scopedDb
      .select({
        member: passwordVaultMembers,
        user: users,
        keyEpoch: passwordVaultKeyEpochs,
      })
      .from(passwordVaultMembers)
      .innerJoin(users, eq(passwordVaultMembers.userId, users.id))
      .innerJoin(passwordVaultKeyEpochs, eq(passwordVaultMembers.keyEpochId, passwordVaultKeyEpochs.id))
      .where(and(
        eq(passwordVaultMembers.organisationId, session.user.organisationId),
        eq(passwordVaultMembers.vaultId, vaultId),
        isNull(passwordVaultMembers.revokedAt),
        isNull(users.deletedAt),
      ))
      .orderBy(desc(passwordVaultMembers.updatedAt))

    return rows.map(toSerializableMember)
  })
}

async function addMember(
  session: PasswordVaultOrgSession,
  vaultId: string,
  payload: ReturnType<typeof parseAddPasswordVaultMemberPayload>,
): Promise<SerializablePasswordVaultMember | 'not-found' | 'forbidden' | 'target-not-found'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    const actorMember = await requireManagerMembership(scopedDb, session, vaultId)

    if (actorMember === 'not-found' || actorMember === 'forbidden') {
      return actorMember
    }

    if (payload.role === 'owner' && actorMember.role !== 'owner') {
      return 'forbidden'
    }

    const target = await scopedDb.query.users.findFirst({
      columns: { id: true },
      where: and(
        eq(users.id, payload.userId),
        eq(users.organisationId, session.user.organisationId),
        eq(users.isActive, true),
        isNull(users.deletedAt),
      ),
    })

    const targetKey = await scopedDb.query.passwordVaultUserKeys.findFirst({
      columns: { id: true },
      where: eq(passwordVaultUserKeys.userId, payload.userId),
    })

    if (!target || !targetKey) {
      return 'target-not-found'
    }

    const currentEpoch = await getCurrentKeyEpoch(scopedDb, session.user.organisationId, vaultId)
    if (!currentEpoch) {
      return 'not-found'
    }

    const now = new Date()
    await scopedDb
      .insert(passwordVaultMembers)
      .values({
        organisationId: session.user.organisationId,
        vaultId,
        userId: payload.userId,
        role: payload.role,
        wrappedVaultKeyEnvelope: payload.wrappedVaultKeyEnvelope,
        keyEpochId: currentEpoch.id,
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [passwordVaultMembers.vaultId, passwordVaultMembers.userId],
        set: {
          role: payload.role,
          wrappedVaultKeyEnvelope: payload.wrappedVaultKeyEnvelope,
          keyEpochId: currentEpoch.id,
          updatedByUserId: session.user.id,
          revokedAt: null,
          revokedByUserId: null,
          updatedAt: now,
        },
      })

    const createdMember = await findSerializableMember(
      scopedDb,
      session.user.organisationId,
      vaultId,
      payload.userId,
    )
    if (!createdMember) {
      throw new Error('Password Vault member create failed')
    }

    await writeAuditEvent(scopedDb, buildPasswordVaultAuditEvent({
      organisationId: session.user.organisationId,
      actorUserId: session.user.id,
      event: 'member_added',
      vaultId,
      targetUserId: payload.userId,
      role: createdMember.role,
    }))

    return createdMember
  })
}

async function updateMember(
  session: PasswordVaultOrgSession,
  vaultId: string,
  userId: string,
  payload: ReturnType<typeof parseUpdatePasswordVaultMemberPayload>,
): Promise<SerializablePasswordVaultMember | 'not-found' | 'forbidden' | 'last-owner'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    const actorMember = await requireManagerMembership(scopedDb, session, vaultId)

    if (actorMember === 'not-found' || actorMember === 'forbidden') {
      return actorMember
    }

    const targetMember = await findSerializableMember(scopedDb, session.user.organisationId, vaultId, userId)
    if (!targetMember) {
      return 'not-found'
    }

    if ((payload.role === 'owner' || targetMember.role === 'owner') && actorMember.role !== 'owner') {
      return 'forbidden'
    }

    const ownerUserIds = await listActiveOwnerUserIds(scopedDb, session.user.organisationId, vaultId)
    if (willLeaveVaultWithoutOwner({
      activeOwnerUserIds: ownerUserIds,
      targetUserId: userId,
      replacementRole: payload.role,
    })) {
      return 'last-owner'
    }

    const now = new Date()
    await scopedDb
      .update(passwordVaultMembers)
      .set({
        role: payload.role,
        ...(payload.wrappedVaultKeyEnvelope
          ? { wrappedVaultKeyEnvelope: payload.wrappedVaultKeyEnvelope }
          : {}),
        updatedByUserId: session.user.id,
        updatedAt: now,
      })
      .where(and(
        eq(passwordVaultMembers.organisationId, session.user.organisationId),
        eq(passwordVaultMembers.vaultId, vaultId),
        eq(passwordVaultMembers.userId, userId),
        isNull(passwordVaultMembers.revokedAt),
      ))

    const updatedMember = await findSerializableMember(scopedDb, session.user.organisationId, vaultId, userId)
    if (!updatedMember) {
      throw new Error('Password Vault member update failed')
    }

    await writeAuditEvent(scopedDb, buildPasswordVaultAuditEvent({
      organisationId: session.user.organisationId,
      actorUserId: session.user.id,
      event: 'member_role_changed',
      vaultId,
      targetUserId: userId,
      role: updatedMember.role,
    }))

    return updatedMember
  })
}

async function removeMember(
  session: PasswordVaultOrgSession,
  vaultId: string,
  userId: string,
): Promise<'deleted' | 'not-found' | 'forbidden' | 'last-owner'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    const actorMember = await requireManagerMembership(scopedDb, session, vaultId)

    if (actorMember === 'not-found' || actorMember === 'forbidden') {
      return actorMember
    }

    const targetMember = await findSerializableMember(scopedDb, session.user.organisationId, vaultId, userId)
    if (!targetMember) {
      return 'not-found'
    }

    if (targetMember.role === 'owner' && actorMember.role !== 'owner') {
      return 'forbidden'
    }

    const ownerUserIds = await listActiveOwnerUserIds(scopedDb, session.user.organisationId, vaultId)
    if (willLeaveVaultWithoutOwner({
      activeOwnerUserIds: ownerUserIds,
      targetUserId: userId,
      replacementRole: null,
    })) {
      return 'last-owner'
    }

    const now = new Date()
    await scopedDb
      .update(passwordVaultMembers)
      .set({
        revokedAt: now,
        revokedByUserId: session.user.id,
        updatedByUserId: session.user.id,
        updatedAt: now,
      })
      .where(and(
        eq(passwordVaultMembers.organisationId, session.user.organisationId),
        eq(passwordVaultMembers.vaultId, vaultId),
        eq(passwordVaultMembers.userId, userId),
        isNull(passwordVaultMembers.revokedAt),
      ))

    await writeAuditEvent(scopedDb, buildPasswordVaultAuditEvent({
      organisationId: session.user.organisationId,
      actorUserId: session.user.id,
      event: 'member_revoked',
      vaultId,
      targetUserId: userId,
      role: targetMember.role,
    }))

    return 'deleted'
  })
}

async function rotateKeyEpoch(
  session: PasswordVaultOrgSession,
  vaultId: string,
  payload: ReturnType<typeof parseRotatePasswordVaultKeyEpochPayload>,
): Promise<PasswordVaultKeyEpoch | 'not-found' | 'forbidden' | 'member-mismatch'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    const actorMember = await requireManagerMembership(scopedDb, session, vaultId)

    if (actorMember === 'not-found' || actorMember === 'forbidden') {
      return actorMember
    }

    const existing = await scopedDb.query.passwordVaultKeyEpochs.findFirst({
      where: and(
        eq(passwordVaultKeyEpochs.organisationId, session.user.organisationId),
        eq(passwordVaultKeyEpochs.vaultId, vaultId),
        eq(passwordVaultKeyEpochs.idempotencyKey, payload.idempotencyKey),
      ),
    })

    if (existing) {
      return existing
    }

    const activeMembers = await scopedDb
      .select({ userId: passwordVaultMembers.userId })
      .from(passwordVaultMembers)
      .where(and(
        eq(passwordVaultMembers.organisationId, session.user.organisationId),
        eq(passwordVaultMembers.vaultId, vaultId),
        isNull(passwordVaultMembers.revokedAt),
      ))

    const activeUserIds = activeMembers.map((member) => member.userId).sort()
    const wrappedUserIds = payload.memberKeyWraps.map((wrap) => wrap.userId).sort()

    if (
      activeUserIds.length !== wrappedUserIds.length ||
      activeUserIds.some((userId, index) => userId !== wrappedUserIds[index])
    ) {
      return 'member-mismatch'
    }

    const currentEpoch = await getCurrentKeyEpoch(scopedDb, session.user.organisationId, vaultId)
    if (!currentEpoch) {
      return 'not-found'
    }

    const now = new Date()
    const [created] = await scopedDb
      .insert(passwordVaultKeyEpochs)
      .values({
        organisationId: session.user.organisationId,
        vaultId,
        epochNumber: currentEpoch.epochNumber + 1,
        wrapVersion: PASSWORD_VAULT_KEY_WRAP_VERSION,
        rotationReason: payload.rotationReason,
        idempotencyKey: payload.idempotencyKey,
        rotatedByUserId: session.user.id,
        createdAt: now,
      })
      .returning()

    const newEpoch = requireRow(created, 'Password Vault key epoch create failed')

    for (const wrap of payload.memberKeyWraps) {
      await scopedDb
        .update(passwordVaultMembers)
        .set({
          wrappedVaultKeyEnvelope: wrap.wrappedVaultKeyEnvelope,
          keyEpochId: newEpoch.id,
          updatedByUserId: session.user.id,
          updatedAt: now,
        })
        .where(and(
          eq(passwordVaultMembers.organisationId, session.user.organisationId),
          eq(passwordVaultMembers.vaultId, vaultId),
          eq(passwordVaultMembers.userId, wrap.userId),
          isNull(passwordVaultMembers.revokedAt),
        ))
    }

    await writeAuditEvent(scopedDb, buildPasswordVaultAuditEvent({
      organisationId: session.user.organisationId,
      actorUserId: session.user.id,
      event: 'key_rotated',
      vaultId,
      keyEpochId: newEpoch.id,
      keyEpochNumber: newEpoch.epochNumber,
      rotationReason: newEpoch.rotationReason,
      memberCount: payload.memberKeyWraps.length,
    }))

    return newEpoch
  })
}

export async function listPasswordVaultMembers(
  request: NextRequest,
  vaultId: string,
): Promise<NextResponse> {
  try {
    assertPasswordVaultReadBodySize(hasRequestBody(request) ? 1 : 0)
    const session = await getApiOrgSession(request.headers)
    const members = await listMembers(session, vaultId)

    if (members === 'not-found') {
      return jsonError('Password Vault not found.', 404)
    }

    return NextResponse.json({ members: members.map(serializePasswordVaultMember) })
  } catch (error) {
    return handlePasswordVaultSharingRouteError(error)
  }
}

export async function addPasswordVaultMember(
  request: NextRequest,
  vaultId: string,
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    if (!await assertShareMutationAllowed(request, session)) {
      return jsonError('Too many Password Vault sharing requests.', 429)
    }
    const payload = parseAddPasswordVaultMemberPayload(await readJsonMutationBody(request))
    const member = await addMember(session, vaultId, payload)

    if (member === 'not-found') return jsonError('Password Vault not found.', 404)
    if (member === 'target-not-found') return jsonError('Password Vault member is not eligible for sharing.', 404)
    if (member === 'forbidden') return jsonError('Forbidden', 403)

    return NextResponse.json(serializePasswordVaultMember(member), { status: 201 })
  } catch (error) {
    return handlePasswordVaultSharingRouteError(error)
  }
}

export async function updatePasswordVaultMember(
  request: NextRequest,
  vaultId: string,
  userId: string,
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    if (!await assertShareMutationAllowed(request, session)) {
      return jsonError('Too many Password Vault sharing requests.', 429)
    }
    const payload = parseUpdatePasswordVaultMemberPayload(await readJsonMutationBody(request))
    const member = await updateMember(session, vaultId, userId, payload)

    if (member === 'not-found') return jsonError('Password Vault member not found.', 404)
    if (member === 'forbidden') return jsonError('Forbidden', 403)
    if (member === 'last-owner') return jsonError('Password Vault must keep at least one owner.', 409)

    return NextResponse.json(serializePasswordVaultMember(member))
  } catch (error) {
    return handlePasswordVaultSharingRouteError(error)
  }
}

export async function removePasswordVaultMember(
  request: NextRequest,
  vaultId: string,
  userId: string,
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    if (!await assertShareMutationAllowed(request, session)) {
      return jsonError('Too many Password Vault sharing requests.', 429)
    }
    const result = await removeMember(session, vaultId, userId)

    if (result === 'not-found') return jsonError('Password Vault member not found.', 404)
    if (result === 'forbidden') return jsonError('Forbidden', 403)
    if (result === 'last-owner') return jsonError('Password Vault must keep at least one owner.', 409)

    return NextResponse.json(createPasswordVaultMemberDeletedResponse(userId))
  } catch (error) {
    return handlePasswordVaultSharingRouteError(error)
  }
}

export async function rotatePasswordVaultKeyEpoch(
  request: NextRequest,
  vaultId: string,
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    const payload = parseRotatePasswordVaultKeyEpochPayload(await readJsonMutationBody(request))
    const epoch = await rotateKeyEpoch(session, vaultId, payload)

    if (epoch === 'not-found') return jsonError('Password Vault not found.', 404)
    if (epoch === 'forbidden') return jsonError('Forbidden', 403)
    if (epoch === 'member-mismatch') {
      return jsonError('Password Vault key rotation must include every active member exactly once.', 409)
    }

    if (epoch.rotationReason === 'initial' || !epoch.idempotencyKey) {
      throw new Error('Password Vault key epoch response invariant failed')
    }

    return NextResponse.json(createPasswordVaultKeyEpochResponse({
      id: epoch.id,
      epochNumber: epoch.epochNumber,
      rotationReason: epoch.rotationReason,
      idempotencyKey: epoch.idempotencyKey,
      createdAt: epoch.createdAt,
    }), { status: 201 })
  } catch (error) {
    return handlePasswordVaultSharingRouteError(error)
  }
}
