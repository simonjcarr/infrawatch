import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { ZodError } from 'zod'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'
import { type TransactionDatabase, withOrgDatabaseScope } from '@/lib/db'
import {
  passwordVaultKeyEpochs,
  passwordVaultMembers,
  passwordVaultUserKeys,
  passwordVaults,
} from '@/lib/db/schema'
import type { PasswordVaultMemberRole } from '@/lib/db/schema/password-vault.ts'
import { assertTrustedMutationOrigin } from '@/lib/security/trusted-origins'
import {
  assertPasswordVaultMutationBodySize,
  assertPasswordVaultReadBodySize,
} from './api-policy.ts'
import {
  createPasswordVaultDeletedResponse,
  parseCreatePasswordVaultPayload,
  parseUpdatePasswordVaultPayload,
  serializePasswordVault,
  type SerializablePasswordVault,
} from './vault-api.ts'

type PasswordVaultOrgSession = Awaited<ReturnType<typeof getApiOrgSession>>

const MANAGER_ROLES = new Set<PasswordVaultMemberRole>(['owner', 'admin'])

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ message }, { status })
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
    return jsonError('Invalid Password Vault vault payload.', 400)
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

  return jsonError('Password Vault vault request failed.', 500)
}

function toSerializableVault(row: {
  vault: typeof passwordVaults.$inferSelect
  member: typeof passwordVaultMembers.$inferSelect
  keyEpoch: typeof passwordVaultKeyEpochs.$inferSelect
}): SerializablePasswordVault {
  return {
    id: row.vault.id,
    encryptedDisplayEnvelope: row.vault.encryptedDisplayEnvelope,
    status: row.vault.status,
    createdAt: row.vault.createdAt,
    updatedAt: row.vault.updatedAt,
    memberRole: row.member.role,
    wrappedVaultKeyEnvelope: row.member.wrappedVaultKeyEnvelope,
    keyEpochId: row.keyEpoch.id,
    keyEpochNumber: row.keyEpoch.epochNumber,
    keyWrapVersion: row.keyEpoch.wrapVersion,
  }
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message)
  }

  return row
}

async function assertUserKeyConfigured(
  scopedDb: TransactionDatabase,
  session: PasswordVaultOrgSession,
): Promise<boolean> {
  const userKey = await scopedDb.query.passwordVaultUserKeys.findFirst({
    columns: { id: true },
    where: eq(passwordVaultUserKeys.userId, session.user.id),
  })

  return Boolean(userKey)
}

async function findAccessibleVault(
  scopedDb: TransactionDatabase,
  session: PasswordVaultOrgSession,
  vaultId: string,
): Promise<SerializablePasswordVault | null> {
  const [row] = await scopedDb
    .select({
      vault: passwordVaults,
      member: passwordVaultMembers,
      keyEpoch: passwordVaultKeyEpochs,
    })
    .from(passwordVaultMembers)
    .innerJoin(passwordVaults, eq(passwordVaultMembers.vaultId, passwordVaults.id))
    .innerJoin(passwordVaultKeyEpochs, eq(passwordVaultMembers.keyEpochId, passwordVaultKeyEpochs.id))
    .where(and(
      eq(passwordVaultMembers.organisationId, session.user.organisationId),
      eq(passwordVaultMembers.userId, session.user.id),
      eq(passwordVaultMembers.vaultId, vaultId),
      isNull(passwordVaultMembers.revokedAt),
      eq(passwordVaults.organisationId, session.user.organisationId),
      isNull(passwordVaults.deletedAt),
    ))
    .limit(1)

  return row ? toSerializableVault(row) : null
}

async function listAccessibleVaults(session: PasswordVaultOrgSession): Promise<SerializablePasswordVault[]> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    const rows = await scopedDb
      .select({
        vault: passwordVaults,
        member: passwordVaultMembers,
        keyEpoch: passwordVaultKeyEpochs,
      })
      .from(passwordVaultMembers)
      .innerJoin(passwordVaults, eq(passwordVaultMembers.vaultId, passwordVaults.id))
      .innerJoin(passwordVaultKeyEpochs, eq(passwordVaultMembers.keyEpochId, passwordVaultKeyEpochs.id))
      .where(and(
        eq(passwordVaultMembers.organisationId, session.user.organisationId),
        eq(passwordVaultMembers.userId, session.user.id),
        isNull(passwordVaultMembers.revokedAt),
        eq(passwordVaults.organisationId, session.user.organisationId),
        isNull(passwordVaults.deletedAt),
      ))
      .orderBy(desc(passwordVaults.updatedAt))

    return rows.map(toSerializableVault)
  })
}

async function createVault(
  session: PasswordVaultOrgSession,
  payload: ReturnType<typeof parseCreatePasswordVaultPayload>,
): Promise<SerializablePasswordVault | 'missing-user-key'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    if (!await assertUserKeyConfigured(scopedDb, session)) {
      return 'missing-user-key'
    }

    const now = new Date()
    const [vault] = await scopedDb
      .insert(passwordVaults)
      .values({
        organisationId: session.user.organisationId,
        encryptedDisplayEnvelope: payload.encryptedDisplayEnvelope,
        status: 'active',
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const createdVault = requireRow(vault, 'Password Vault create failed')

    const [keyEpoch] = await scopedDb
      .insert(passwordVaultKeyEpochs)
      .values({
        organisationId: session.user.organisationId,
        vaultId: createdVault.id,
        epochNumber: 1,
        wrapVersion: payload.keyWrapVersion,
        rotationReason: 'initial',
        rotatedByUserId: session.user.id,
        createdAt: now,
      })
      .returning()
    const createdKeyEpoch = requireRow(keyEpoch, 'Password Vault key epoch create failed')

    const [member] = await scopedDb
      .insert(passwordVaultMembers)
      .values({
        organisationId: session.user.organisationId,
        vaultId: createdVault.id,
        userId: session.user.id,
        role: 'owner',
        wrappedVaultKeyEnvelope: payload.wrappedVaultKeyEnvelope,
        keyEpochId: createdKeyEpoch.id,
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const createdMember = requireRow(member, 'Password Vault owner membership create failed')

    return toSerializableVault({ vault: createdVault, member: createdMember, keyEpoch: createdKeyEpoch })
  })
}

async function updateVault(
  session: PasswordVaultOrgSession,
  vaultId: string,
  payload: ReturnType<typeof parseUpdatePasswordVaultPayload>,
): Promise<SerializablePasswordVault | 'not-found' | 'forbidden'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    const current = await findAccessibleVault(scopedDb, session, vaultId)

    if (!current) {
      return 'not-found'
    }

    if (!MANAGER_ROLES.has(current.memberRole)) {
      return 'forbidden'
    }

    const now = new Date()
    const [updated] = await scopedDb
      .update(passwordVaults)
      .set({
        encryptedDisplayEnvelope: payload.encryptedDisplayEnvelope,
        updatedByUserId: session.user.id,
        updatedAt: now,
      })
      .where(and(
        eq(passwordVaults.id, vaultId),
        eq(passwordVaults.organisationId, session.user.organisationId),
        isNull(passwordVaults.deletedAt),
      ))
      .returning()
    const updatedVault = requireRow(updated, 'Password Vault update failed')

    return {
      ...current,
      encryptedDisplayEnvelope: updatedVault.encryptedDisplayEnvelope,
      updatedAt: updatedVault.updatedAt,
    }
  })
}

async function deleteVault(
  session: PasswordVaultOrgSession,
  vaultId: string,
): Promise<'deleted' | 'not-found' | 'forbidden'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    const current = await findAccessibleVault(scopedDb, session, vaultId)

    if (!current) {
      return 'not-found'
    }

    if (!MANAGER_ROLES.has(current.memberRole)) {
      return 'forbidden'
    }

    const now = new Date()
    await scopedDb
      .update(passwordVaults)
      .set({
        deletedAt: now,
        deletedByUserId: session.user.id,
        updatedByUserId: session.user.id,
        updatedAt: now,
      })
      .where(and(
        eq(passwordVaults.id, vaultId),
        eq(passwordVaults.organisationId, session.user.organisationId),
        isNull(passwordVaults.deletedAt),
      ))

    return 'deleted'
  })
}

export async function listPasswordVaults(request: NextRequest): Promise<NextResponse> {
  try {
    assertPasswordVaultReadBodySize(hasRequestBody(request) ? 1 : 0)
    const session = await getApiOrgSession(request.headers)
    const vaults = await listAccessibleVaults(session)

    return NextResponse.json({ vaults: vaults.map(serializePasswordVault) })
  } catch (error) {
    return handlePasswordVaultRouteError(error)
  }
}

export async function createPasswordVault(request: NextRequest): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    const payload = parseCreatePasswordVaultPayload(await readJsonMutationBody(request))
    const created = await createVault(session, payload)

    if (created === 'missing-user-key') {
      return jsonError('Password Vault setup is required before creating a vault.', 409)
    }

    return NextResponse.json(serializePasswordVault(created), { status: 201 })
  } catch (error) {
    return handlePasswordVaultRouteError(error)
  }
}

export async function getPasswordVault(
  request: NextRequest,
  vaultId: string,
): Promise<NextResponse> {
  try {
    assertPasswordVaultReadBodySize(hasRequestBody(request) ? 1 : 0)
    const session = await getApiOrgSession(request.headers)
    const vault = await withOrgDatabaseScope(
      session.user.organisationId,
      (scopedDb) => findAccessibleVault(scopedDb, session, vaultId),
    )

    if (!vault) {
      return jsonError('Password Vault not found.', 404)
    }

    return NextResponse.json(serializePasswordVault(vault))
  } catch (error) {
    return handlePasswordVaultRouteError(error)
  }
}

export async function updatePasswordVault(
  request: NextRequest,
  vaultId: string,
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    const payload = parseUpdatePasswordVaultPayload(await readJsonMutationBody(request))
    const updated = await updateVault(session, vaultId, payload)

    if (updated === 'not-found') {
      return jsonError('Password Vault not found.', 404)
    }

    if (updated === 'forbidden') {
      return jsonError('Forbidden', 403)
    }

    return NextResponse.json(serializePasswordVault(updated))
  } catch (error) {
    return handlePasswordVaultRouteError(error)
  }
}

export async function deletePasswordVault(
  request: NextRequest,
  vaultId: string,
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    const result = await deleteVault(session, vaultId)

    if (result === 'not-found') {
      return jsonError('Password Vault not found.', 404)
    }

    if (result === 'forbidden') {
      return jsonError('Forbidden', 403)
    }

    return NextResponse.json(createPasswordVaultDeletedResponse(vaultId))
  } catch (error) {
    return handlePasswordVaultRouteError(error)
  }
}
