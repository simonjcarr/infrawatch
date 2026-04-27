'use server'

import { logError } from '@/lib/logging'
import { requireOrgAccess } from '@/lib/actions/action-auth'

import { db } from '@/lib/db'
import { organisations, hosts, terminalSessions } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { createHash, randomBytes } from 'node:crypto'
import { getRequiredSession } from '@/lib/auth/session'
import { parseOrgMetadata } from '@/lib/db/schema/organisations'
import { parseHostMetadata } from '@/lib/db/schema/hosts'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { writeAuditEvent } from '@/lib/audit/events'

export interface TerminalAccessResult {
  allowed: true
  directAccess: false
}

export interface TerminalAccessDenied {
  allowed: false
  reason: string
}

/**
 * Checks whether the current user has terminal access to the given host.
 * Used to show/hide the terminal tab without creating a session.
 */
export async function checkTerminalAccess(
  orgId: string,
  hostId: string,
): Promise<TerminalAccessResult | TerminalAccessDenied> {
  await requireOrgAccess(orgId)
  const session = await getRequiredSession()
  const { user } = session

  // 1. Role check
  if (user.role === 'read_only') {
    return { allowed: false, reason: 'Terminal access requires at minimum engineer role' }
  }

  // 2. Org-level terminal enabled
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  const orgMeta = parseOrgMetadata(org?.metadata)
  if (orgMeta.terminalEnabled === false) {
    return { allowed: false, reason: 'Terminal access is disabled for this organisation' }
  }

  // 3. Host-level terminal enabled
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
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
  orgId: string,
  hostId: string,
  username?: string,
): Promise<{ sessionId: string; ingestWsUrl: string; websocketToken: string } | { error: string }> {
  await requireOrgAccess(orgId)
  const access = await checkTerminalAccess(orgId, hostId)
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
      organisationId: orgId,
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

// --- Org-level terminal settings ---

export interface OrgTerminalSettings {
  terminalEnabled: boolean
  terminalLoggingEnabled: boolean
  terminalDirectAccess: boolean
}

export async function getOrgTerminalSettings(
  orgId: string,
): Promise<OrgTerminalSettings> {
  await requireOrgAccess(orgId)
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  const meta = parseOrgMetadata(org?.metadata)
  return {
    terminalEnabled: meta.terminalEnabled !== false,
    terminalLoggingEnabled: meta.terminalLoggingEnabled === true,
    terminalDirectAccess: false,
  }
}

export async function updateOrgTerminalSettings(
  orgId: string,
  settings: OrgTerminalSettings,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  try {
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
      columns: { id: true, metadata: true },
    })
    if (!org) return { error: 'Organisation not found' }

    const currentMetadata = parseOrgMetadata(org.metadata)
    const updatedMetadata = {
      ...currentMetadata,
      terminalEnabled: settings.terminalEnabled,
      terminalLoggingEnabled: settings.terminalLoggingEnabled,
      terminalDirectAccess: false,
    }

    await db
      .update(organisations)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(organisations.id, orgId))

    await writeAuditEvent(db, {
      organisationId: orgId,
      actorUserId: session.user.id,
      action: 'terminal.org_settings.updated',
      targetType: 'organisation',
      targetId: orgId,
      summary: 'Updated organisation terminal settings',
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
    logError('Failed to update org terminal settings:', err)
    return { error: 'An unexpected error occurred' }
  }
}

// --- Host-level terminal settings ---

export interface HostTerminalSettings {
  terminalEnabled: boolean
  terminalAllowedUsers: string[]
}

export async function getHostTerminalSettings(
  orgId: string,
  hostId: string,
): Promise<HostTerminalSettings> {
  await requireOrgAccess(orgId)
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
    columns: { metadata: true },
  })
  const meta = parseHostMetadata(host?.metadata)
  return {
    terminalEnabled: meta.terminalEnabled !== false,
    terminalAllowedUsers: meta.terminalAllowedUsers ?? [],
  }
}

export async function updateHostTerminalSettings(
  orgId: string,
  hostId: string,
  settings: HostTerminalSettings,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  try {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
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
      .where(and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId)))

    await writeAuditEvent(db, {
      organisationId: orgId,
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
