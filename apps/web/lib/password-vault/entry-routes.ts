import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { ZodError } from 'zod'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'
import { type TransactionDatabase, withOrgDatabaseScope } from '@/lib/db'
import {
  passwordVaultEntries,
  passwordVaultMembers,
  passwordVaults,
} from '@/lib/db/schema'
import { assertTrustedMutationOrigin } from '@/lib/security/trusted-origins'
import {
  assertPasswordVaultMutationBodySize,
  assertPasswordVaultReadBodySize,
} from './api-policy.ts'
import {
  PASSWORD_VAULT_ENTRY_ENVELOPE_VERSION,
  createPasswordVaultEntryDeletedResponse,
  parseCreatePasswordVaultEntryPayload,
  parseUpdatePasswordVaultEntryPayload,
  serializePasswordVaultEntry,
  type SerializablePasswordVaultEntry,
} from './entry-api.ts'

type PasswordVaultOrgSession = Awaited<ReturnType<typeof getApiOrgSession>>

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

function handlePasswordVaultEntryRouteError(error: unknown): NextResponse {
  if (error instanceof ApiAuthError) {
    return jsonError(error.message, error.status)
  }

  if (error instanceof ZodError || error instanceof SyntaxError || error instanceof TypeError) {
    return jsonError('Invalid Password Vault entry payload.', 400)
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

  return jsonError('Password Vault entry request failed.', 500)
}

function toSerializableEntry(entry: typeof passwordVaultEntries.$inferSelect): SerializablePasswordVaultEntry {
  return {
    id: entry.id,
    vaultId: entry.vaultId,
    encryptedPayloadEnvelope: entry.encryptedPayloadEnvelope,
    encryptedDisplayEnvelope: entry.encryptedDisplayEnvelope,
    envelopeVersion: entry.envelopeVersion,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message)
  }

  return row
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

async function listEntries(
  session: PasswordVaultOrgSession,
  vaultId: string,
): Promise<SerializablePasswordVaultEntry[] | 'not-found'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    if (!await hasActiveVaultMembership(scopedDb, session, vaultId)) {
      return 'not-found'
    }

    const entries = await scopedDb
      .select()
      .from(passwordVaultEntries)
      .where(and(
        eq(passwordVaultEntries.organisationId, session.user.organisationId),
        eq(passwordVaultEntries.vaultId, vaultId),
        isNull(passwordVaultEntries.deletedAt),
      ))
      .orderBy(desc(passwordVaultEntries.updatedAt))

    return entries.map(toSerializableEntry)
  })
}

async function findEntry(
  scopedDb: TransactionDatabase,
  session: PasswordVaultOrgSession,
  vaultId: string,
  entryId: string,
): Promise<SerializablePasswordVaultEntry | null> {
  if (!await hasActiveVaultMembership(scopedDb, session, vaultId)) {
    return null
  }

  const [entry] = await scopedDb
    .select()
    .from(passwordVaultEntries)
    .where(and(
      eq(passwordVaultEntries.id, entryId),
      eq(passwordVaultEntries.organisationId, session.user.organisationId),
      eq(passwordVaultEntries.vaultId, vaultId),
      isNull(passwordVaultEntries.deletedAt),
    ))
    .limit(1)

  return entry ? toSerializableEntry(entry) : null
}

async function createEntry(
  session: PasswordVaultOrgSession,
  vaultId: string,
  payload: ReturnType<typeof parseCreatePasswordVaultEntryPayload>,
): Promise<SerializablePasswordVaultEntry | 'not-found'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    if (!await hasActiveVaultMembership(scopedDb, session, vaultId)) {
      return 'not-found'
    }

    const now = new Date()
    const [entry] = await scopedDb
      .insert(passwordVaultEntries)
      .values({
        organisationId: session.user.organisationId,
        vaultId,
        encryptedPayloadEnvelope: payload.encryptedPayloadEnvelope,
        encryptedDisplayEnvelope: payload.encryptedDisplayEnvelope,
        envelopeVersion: payload.envelopeVersion,
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    await scopedDb
      .update(passwordVaults)
      .set({
        updatedByUserId: session.user.id,
        updatedAt: now,
      })
      .where(and(
        eq(passwordVaults.id, vaultId),
        eq(passwordVaults.organisationId, session.user.organisationId),
        isNull(passwordVaults.deletedAt),
      ))

    return toSerializableEntry(requireRow(entry, 'Password Vault entry create failed'))
  })
}

async function updateEntry(
  session: PasswordVaultOrgSession,
  vaultId: string,
  entryId: string,
  payload: ReturnType<typeof parseUpdatePasswordVaultEntryPayload>,
): Promise<SerializablePasswordVaultEntry | 'not-found'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    if (!await findEntry(scopedDb, session, vaultId, entryId)) {
      return 'not-found'
    }

    const now = new Date()
    const [entry] = await scopedDb
      .update(passwordVaultEntries)
      .set({
        encryptedPayloadEnvelope: payload.encryptedPayloadEnvelope,
        encryptedDisplayEnvelope: payload.encryptedDisplayEnvelope,
        envelopeVersion: PASSWORD_VAULT_ENTRY_ENVELOPE_VERSION,
        updatedByUserId: session.user.id,
        updatedAt: now,
      })
      .where(and(
        eq(passwordVaultEntries.id, entryId),
        eq(passwordVaultEntries.organisationId, session.user.organisationId),
        eq(passwordVaultEntries.vaultId, vaultId),
        isNull(passwordVaultEntries.deletedAt),
      ))
      .returning()

    await scopedDb
      .update(passwordVaults)
      .set({
        updatedByUserId: session.user.id,
        updatedAt: now,
      })
      .where(and(
        eq(passwordVaults.id, vaultId),
        eq(passwordVaults.organisationId, session.user.organisationId),
        isNull(passwordVaults.deletedAt),
      ))

    return toSerializableEntry(requireRow(entry, 'Password Vault entry update failed'))
  })
}

async function deleteEntry(
  session: PasswordVaultOrgSession,
  vaultId: string,
  entryId: string,
): Promise<'deleted' | 'not-found'> {
  return withOrgDatabaseScope(session.user.organisationId, async (scopedDb) => {
    if (!await findEntry(scopedDb, session, vaultId, entryId)) {
      return 'not-found'
    }

    const now = new Date()
    await scopedDb
      .update(passwordVaultEntries)
      .set({
        deletedAt: now,
        deletedByUserId: session.user.id,
        updatedByUserId: session.user.id,
        updatedAt: now,
      })
      .where(and(
        eq(passwordVaultEntries.id, entryId),
        eq(passwordVaultEntries.organisationId, session.user.organisationId),
        eq(passwordVaultEntries.vaultId, vaultId),
        isNull(passwordVaultEntries.deletedAt),
      ))

    await scopedDb
      .update(passwordVaults)
      .set({
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

export async function listPasswordVaultEntries(
  request: NextRequest,
  vaultId: string,
): Promise<NextResponse> {
  try {
    assertPasswordVaultReadBodySize(hasRequestBody(request) ? 1 : 0)
    const session = await getApiOrgSession(request.headers)
    const entries = await listEntries(session, vaultId)

    if (entries === 'not-found') {
      return jsonError('Password Vault not found.', 404)
    }

    return NextResponse.json({ entries: entries.map(serializePasswordVaultEntry) })
  } catch (error) {
    return handlePasswordVaultEntryRouteError(error)
  }
}

export async function createPasswordVaultEntry(
  request: NextRequest,
  vaultId: string,
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    const payload = parseCreatePasswordVaultEntryPayload(await readJsonMutationBody(request))
    const entry = await createEntry(session, vaultId, payload)

    if (entry === 'not-found') {
      return jsonError('Password Vault not found.', 404)
    }

    return NextResponse.json(serializePasswordVaultEntry(entry), { status: 201 })
  } catch (error) {
    return handlePasswordVaultEntryRouteError(error)
  }
}

export async function getPasswordVaultEntry(
  request: NextRequest,
  vaultId: string,
  entryId: string,
): Promise<NextResponse> {
  try {
    assertPasswordVaultReadBodySize(hasRequestBody(request) ? 1 : 0)
    const session = await getApiOrgSession(request.headers)
    const entry = await withOrgDatabaseScope(
      session.user.organisationId,
      (scopedDb) => findEntry(scopedDb, session, vaultId, entryId),
    )

    if (!entry) {
      return jsonError('Password Vault entry not found.', 404)
    }

    return NextResponse.json(serializePasswordVaultEntry(entry))
  } catch (error) {
    return handlePasswordVaultEntryRouteError(error)
  }
}

export async function updatePasswordVaultEntry(
  request: NextRequest,
  vaultId: string,
  entryId: string,
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    const payload = parseUpdatePasswordVaultEntryPayload(await readJsonMutationBody(request))
    const entry = await updateEntry(session, vaultId, entryId, payload)

    if (entry === 'not-found') {
      return jsonError('Password Vault entry not found.', 404)
    }

    return NextResponse.json(serializePasswordVaultEntry(entry))
  } catch (error) {
    return handlePasswordVaultEntryRouteError(error)
  }
}

export async function deletePasswordVaultEntry(
  request: NextRequest,
  vaultId: string,
  entryId: string,
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request.headers)
    const session = await getApiOrgSession(request.headers)
    const result = await deleteEntry(session, vaultId, entryId)

    if (result === 'not-found') {
      return jsonError('Password Vault entry not found.', 404)
    }

    return NextResponse.json(createPasswordVaultEntryDeletedResponse(entryId))
  } catch (error) {
    return handlePasswordVaultEntryRouteError(error)
  }
}
