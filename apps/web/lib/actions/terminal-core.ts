'use server'

import { logError } from '@/lib/logging'
import { requireInstanceAccess, requireInstanceAdminAccess } from '@/lib/actions/action-auth'

import { db } from '@/lib/db'
import { instanceSettings, hosts, terminalSessions } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { createHash, randomBytes } from 'node:crypto'
import { getRequiredSession } from '@/lib/auth/session'
import { parseInstanceMetadata } from '@/lib/db/schema/instance-settings'
import { parseHostMetadata, type SshHostKeyMetadata } from '@/lib/db/schema/hosts'
import { MEMBERSHIP_ROLES } from '@/lib/auth/roles'
import { hasRole } from '@/lib/auth/guards'
import { writeAuditEvent } from '@/lib/audit/events'

export interface TerminalAccessResult {
  allowed: true
  directAccess: false
}

export interface TerminalAccessDenied {
  allowed: false
  reason: string
}

async function resolveCurrentActionScope(): Promise<string> {
  const session = await getRequiredSession()
  const instanceId = session.user.instanceId
  if (!instanceId) {
    throw new Error('Instance scope is not configured')
  }
  return instanceId
}

/**
 * Checks whether the current user has terminal access to the given host.
 * Used to show/hide the terminal tab without creating a session.
 */
export async function checkTerminalAccess(
  hostId: string,
): Promise<TerminalAccessResult | TerminalAccessDenied>
export async function checkTerminalAccess(
  instanceId: string,
  hostId: string,
): Promise<TerminalAccessResult | TerminalAccessDenied>
export async function checkTerminalAccess(
  instanceIdOrHostId: string,
  maybeHostId?: string,
): Promise<TerminalAccessResult | TerminalAccessDenied> {
  const instanceId = maybeHostId ? instanceIdOrHostId : await resolveCurrentActionScope()
  const hostId = maybeHostId ?? instanceIdOrHostId
  const session = await requireInstanceAccess(instanceId)
  const { user } = session

  // 1. Role check
  if (!hasRole(user, MEMBERSHIP_ROLES)) {
    return { allowed: false, reason: 'Terminal access requires at minimum engineer role' }
  }

  // 2. Instance-level terminal enabled
  const instance = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })
  const instanceMeta = parseInstanceMetadata(instance?.metadata)
  if (instanceMeta.terminalEnabled === false) {
    return { allowed: false, reason: 'Terminal access is disabled for this instance' }
  }

  // 3. Host-level terminal enabled
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)),
    columns: { metadata: true },
  })
  if (!host) {
    return { allowed: false, reason: 'Host not found' }
  }
  const hostMeta = parseHostMetadata(host.metadata)
  if (hostMeta.terminalEnabled === false) {
    return { allowed: false, reason: 'Terminal access is disabled for this host' }
  }

  // 4. User allowlist
  const allowedUsers = hostMeta.terminalAllowedUsers ?? []
  if (allowedUsers.length > 0 && !allowedUsers.includes(user.id)) {
    return { allowed: false, reason: 'You are not authorised to access this host terminal' }
  }

  // Terminal access is always SSH-backed. CTOps never opens a shell through
  // the agent or as the agent/root user.
  return { allowed: true, directAccess: false }
}

// POSIX-compliant: starts with letter or underscore, contains only [a-zA-Z0-9_-], max 32 chars
const VALID_USERNAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,31}$/

/**
 * Creates a terminal session record and returns the session ID + ingest WS URL.
 * Performs full access control checks before creating the session.
 * When not in direct access mode, username is required and validated.
 */
export async function createTerminalSession(
  hostId: string,
  username?: string,
): Promise<{ sessionId: string; ingestWsUrl: string; websocketToken: string } | { error: string }>
export async function createTerminalSession(
  instanceId: string,
  hostId: string,
  username?: string,
): Promise<{ sessionId: string; ingestWsUrl: string; websocketToken: string } | { error: string }>
export async function createTerminalSession(
  instanceIdOrHostId: string,
  hostIdOrUsername?: string,
  maybeUsername?: string,
): Promise<{ sessionId: string; ingestWsUrl: string; websocketToken: string } | { error: string }> {
  const instanceId = maybeUsername !== undefined ? instanceIdOrHostId : await resolveCurrentActionScope()
  const hostId = maybeUsername !== undefined ? hostIdOrUsername! : instanceIdOrHostId
  const username = maybeUsername !== undefined ? maybeUsername : hostIdOrUsername
  await requireInstanceAccess(instanceId)
  const access = await checkTerminalAccess(instanceId, hostId)
  if (!access.allowed) {
    return { error: access.reason }
  }

  const trimmedUsername = username?.trim()
  if (!trimmedUsername) {
    return { error: 'Username is required for SSH terminal access' }
  }
  if (trimmedUsername.length > 256) {
    return { error: 'Username is too long' }
  }
  if (!VALID_USERNAME_RE.test(trimmedUsername)) {
    return { error: 'Username contains invalid characters' }
  }

  const session = await getRequiredSession()

  try {
    const sessionId = createId()
    const websocketToken = randomBytes(32).toString('base64url')
    const websocketTokenHash = createHash('sha256').update(websocketToken).digest('hex')
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

    await db.insert(terminalSessions).values({
      instanceId: instanceId,
      hostId,
      userId: session.user.id,
      sessionId,
      username: trimmedUsername,
      websocketTokenHash,
      expiresAt,
      status: 'pending',
    })

    // When INGEST_WS_URL is an absolute URL, the browser connects directly to
    // the ingest service. When it is empty or a path, we return a path-only
    // URL so the browser connects to the same origin it loaded the page from.
    // Same-origin mode is required for deployments behind a reverse proxy or
    // Cloudflare tunnel, where only the web app's hostname is publicly
    // reachable and the proxy routes /ws/terminal/* to the ingest service.
    const rawBase = (process.env['INGEST_WS_URL'] ?? '').trim().replace(/\/+$/, '')
    // Accept http(s):// for convenience and rewrite to ws(s):// — new WebSocket()
    // only accepts the ws schemes.
    const normalised = rawBase
      .replace(/^http:\/\//i, 'ws://')
      .replace(/^https:\/\//i, 'wss://')
    const isAbsolute = /^wss?:\/\//i.test(normalised)
    const ingestWsUrl = isAbsolute
      ? `${normalised}/ws/terminal/${sessionId}`
      : `/ws/terminal/${sessionId}`
    return {
      sessionId,
      ingestWsUrl,
      websocketToken,
    }
  } catch (err) {
    logError('Failed to create terminal session:', err)
    return { error: 'An unexpected error occurred' }
  }
}

// --- Instance-level terminal settings ---

export interface InstanceTerminalSettings {
  terminalEnabled: boolean
  terminalLoggingEnabled: boolean
  terminalDirectAccess: boolean
}

export async function getInstanceTerminalSettings(
  instanceId: string,
): Promise<InstanceTerminalSettings> {
  await requireInstanceAccess(instanceId)
  const instance = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })
  const meta = parseInstanceMetadata(instance?.metadata)
  return {
    terminalEnabled: meta.terminalEnabled !== false,
    terminalLoggingEnabled: meta.terminalLoggingEnabled === true,
    terminalDirectAccess: false,
  }
}

export async function updateInstanceTerminalSettings(
  instanceId: string,
  settings: InstanceTerminalSettings,
): Promise<{ success: true } | { error: string }> {
  let session
  try {
    session = await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to perform this action' }
  }

  try {
    const instance = await db.query.instanceSettings.findFirst({
      where: eq(instanceSettings.id, instanceId),
      columns: { id: true, metadata: true },
    })
    if (!instance) return { error: 'Instance not found' }

    const currentMetadata = parseInstanceMetadata(instance.metadata)
    const updatedMetadata = {
      ...currentMetadata,
      terminalEnabled: settings.terminalEnabled,
      terminalLoggingEnabled: settings.terminalLoggingEnabled,
      terminalDirectAccess: false,
    }

    await db
      .update(instanceSettings)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(instanceSettings.id, instanceId))

    await writeAuditEvent(db, {
      instanceId: instanceId,
      actorUserId: session.user.id,
      action: 'terminal.org_settings.updated',
      targetType: 'instance',
      targetId: instanceId,
      summary: 'Updated instance terminal settings',
      metadata: {
        previous: {
          terminalEnabled: currentMetadata.terminalEnabled !== false,
          terminalLoggingEnabled: currentMetadata.terminalLoggingEnabled === true,
          terminalDirectAccess: false,
        },
        next: updatedMetadata,
      },
    })

    return { success: true }
  } catch (err) {
    logError('Failed to update instance terminal settings:', err)
    return { error: 'An unexpected error occurred' }
  }
}

// --- Host-level terminal settings ---

export interface HostTerminalSettings {
  terminalEnabled: boolean
  terminalAllowedUsers: string[]
  sshHostKeys: SshHostKeyMetadata[]
  pendingSshHostKeys: SshHostKeyMetadata[]
  sshHostKeyStatus?: 'changed'
  sshHostKeyChangedAt?: string
}

export async function getHostTerminalSettings(
  instanceId: string,
  hostId: string,
): Promise<HostTerminalSettings> {
  await requireInstanceAccess(instanceId)
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)),
    columns: { metadata: true },
  })
  const meta = parseHostMetadata(host?.metadata)
  return {
    terminalEnabled: meta.terminalEnabled !== false,
    terminalAllowedUsers: meta.terminalAllowedUsers ?? [],
    sshHostKeys: normaliseHostKeys(meta.sshHostKeys, meta.sshHostKeySha256),
    pendingSshHostKeys: normaliseHostKeys(meta.pendingSshHostKeys),
    sshHostKeyStatus: meta.sshHostKeyStatus,
    sshHostKeyChangedAt: meta.sshHostKeyChangedAt,
  }
}

export async function updateHostTerminalSettings(
  instanceId: string,
  hostId: string,
  settings: HostTerminalSettings,
): Promise<{ success: true } | { error: string }> {
  let session
  try {
    session = await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to perform this action' }
  }

  try {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)),
      columns: { id: true, metadata: true },
    })
    if (!host) return { error: 'Host not found' }

    const currentMetadata = parseHostMetadata(host.metadata)
    const updatedMetadata = {
      ...currentMetadata,
      terminalEnabled: settings.terminalEnabled,
      terminalAllowedUsers: settings.terminalAllowedUsers,
    }

    await db
      .update(hosts)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId)))

    await writeAuditEvent(db, {
      instanceId: instanceId,
      actorUserId: session.user.id,
      action: 'terminal.host_settings.updated',
      targetType: 'host',
      targetId: hostId,
      summary: 'Updated host terminal settings',
      metadata: {
        previous: {
          terminalEnabled: currentMetadata.terminalEnabled !== false,
          terminalAllowedUsers: currentMetadata.terminalAllowedUsers ?? [],
        },
        next: updatedMetadata,
      },
    })

    return { success: true }
  } catch (err) {
    logError('Failed to update host terminal settings:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function trustPendingSshHostKeys(
  instanceId: string,
  hostId: string,
): Promise<{ success: true } | { error: string }> {
  let session
  try {
    session = await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to perform this action' }
  }

  try {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)),
      columns: { id: true, metadata: true },
    })
    if (!host) return { error: 'Host not found' }

    const currentMetadata = parseHostMetadata(host.metadata)
    const pendingKeys = normaliseHostKeys(currentMetadata.pendingSshHostKeys)
    if (pendingKeys.length === 0) {
      return { error: 'No pending SSH host key is available to trust' }
    }

    const updatedMetadata = {
      ...currentMetadata,
      sshHostKeys: pendingKeys,
      sshHostKeySha256: pendingKeys[0]?.fingerprintSha256,
      pendingSshHostKeys: [],
      sshHostKeyStatus: undefined,
      sshHostKeyChangedAt: undefined,
    }

    await db
      .update(hosts)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId)))

    await writeAuditEvent(db, {
      instanceId: instanceId,
      actorUserId: session.user.id,
      action: 'terminal.host_ssh_key.trusted',
      targetType: 'host',
      targetId: hostId,
      summary: 'Trusted pending SSH host key for terminal access',
      metadata: {
        previous: {
          sshHostKeys: normaliseHostKeys(currentMetadata.sshHostKeys, currentMetadata.sshHostKeySha256),
          pendingSshHostKeys: pendingKeys,
          sshHostKeyStatus: currentMetadata.sshHostKeyStatus,
          sshHostKeyChangedAt: currentMetadata.sshHostKeyChangedAt,
        },
        next: {
          sshHostKeys: pendingKeys,
        },
      },
    })

    return { success: true }
  } catch (err) {
    logError('Failed to trust pending SSH host key:', err)
    return { error: 'An unexpected error occurred' }
  }
}

function normaliseHostKeys(keys?: SshHostKeyMetadata[], legacyFingerprint?: string): SshHostKeyMetadata[] {
  const result: SshHostKeyMetadata[] = []
  const seen = new Set<string>()
  for (const key of keys ?? []) {
    if (!key.fingerprintSha256) continue
    const identity = `${key.algorithm ?? ''}\0${key.fingerprintSha256}`
    if (seen.has(identity)) continue
    seen.add(identity)
    result.push({
      algorithm: key.algorithm,
      fingerprintSha256: key.fingerprintSha256,
    })
  }
  if (result.length === 0 && legacyFingerprint) {
    result.push({ fingerprintSha256: legacyFingerprint })
  }
  return result
}
