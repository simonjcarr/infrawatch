'use server'

import { db } from '@/lib/db'
import { organisations, hosts, terminalSessions } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { getRequiredSession } from '@/lib/auth/session'
import type { OrgMetadata, HostMetadata } from '@/lib/db/schema'
import { ADMIN_ROLES } from '@/lib/auth/roles'

export interface TerminalAccessResult {
  allowed: true
  directAccess: boolean
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
  const orgMeta = (org?.metadata ?? {}) as OrgMetadata
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
  const hostMeta = (host.metadata ?? { disks: [], network_interfaces: [] }) as HostMetadata
  if (hostMeta.terminalEnabled === false) {
    return { allowed: false, reason: 'Terminal access is disabled for this host' }
  }

  // 4. User allowlist
  const allowedUsers = hostMeta.terminalAllowedUsers ?? []
  if (allowedUsers.length > 0 && !allowedUsers.includes(user.id)) {
    return { allowed: false, reason: 'You are not authorised to access this host terminal' }
  }

  return { allowed: true, directAccess: orgMeta.terminalDirectAccess === true }
}

const VALID_USERNAME_RE = /^[a-zA-Z0-9._@\\-]+$/

/**
 * Creates a terminal session record and returns the session ID + ingest WS URL.
 * Performs full access control checks before creating the session.
 * When not in direct access mode, username is required and validated.
 */
export async function createTerminalSession(
  orgId: string,
  hostId: string,
  username?: string,
): Promise<{ sessionId: string; ingestWsUrl: string } | { error: string }> {
  const access = await checkTerminalAccess(orgId, hostId)
  if (!access.allowed) {
    return { error: access.reason }
  }

  // Validate username when not in direct access mode
  const trimmedUsername = username?.trim()
  if (!access.directAccess) {
    if (!trimmedUsername) {
      return { error: 'Username is required for terminal access' }
    }
    if (trimmedUsername.length > 256) {
      return { error: 'Username is too long' }
    }
    if (!VALID_USERNAME_RE.test(trimmedUsername)) {
      return { error: 'Username contains invalid characters' }
    }
  }

  const session = await getRequiredSession()

  try {
    const sessionId = createId()

    await db.insert(terminalSessions).values({
      organisationId: orgId,
      hostId,
      userId: session.user.id,
      sessionId,
      username: access.directAccess ? null : (trimmedUsername ?? null),
      status: 'pending',
    })

    const ingestWsUrl = process.env['INGEST_WS_URL'] ?? 'ws://localhost:8080'
    return {
      sessionId,
      ingestWsUrl: `${ingestWsUrl}/ws/terminal/${sessionId}`,
    }
  } catch (err) {
    console.error('Failed to create terminal session:', err)
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
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  const meta = (org?.metadata ?? {}) as OrgMetadata
  return {
    terminalEnabled: meta.terminalEnabled !== false,
    terminalLoggingEnabled: meta.terminalLoggingEnabled === true,
    terminalDirectAccess: meta.terminalDirectAccess === true,
  }
}

export async function updateOrgTerminalSettings(
  orgId: string,
  settings: OrgTerminalSettings,
): Promise<{ success: true } | { error: string }> {
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

    const currentMetadata = (org.metadata ?? {}) as OrgMetadata
    const updatedMetadata: OrgMetadata = {
      ...currentMetadata,
      terminalEnabled: settings.terminalEnabled,
      terminalLoggingEnabled: settings.terminalLoggingEnabled,
      terminalDirectAccess: settings.terminalDirectAccess,
    }

    await db
      .update(organisations)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(organisations.id, orgId))

    return { success: true }
  } catch (err) {
    console.error('Failed to update org terminal settings:', err)
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
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
    columns: { metadata: true },
  })
  const meta = (host?.metadata ?? { disks: [], network_interfaces: [] }) as HostMetadata
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

    const currentMetadata = (host.metadata ?? { disks: [], network_interfaces: [] }) as HostMetadata
    const updatedMetadata: HostMetadata = {
      ...currentMetadata,
      terminalEnabled: settings.terminalEnabled,
      terminalAllowedUsers: settings.terminalAllowedUsers,
    }

    await db
      .update(hosts)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId)))

    return { success: true }
  } catch (err) {
    console.error('Failed to update host terminal settings:', err)
    return { error: 'An unexpected error occurred' }
  }
}
