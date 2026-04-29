import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { User } from '@/lib/db/schema'
import { requireActiveUser, requireOrgAdmin } from './guards'

// Re-export User as SessionUser for convenience
export type { User as SessionUser }

export type RequiredSession = {
  session: {
    id: string
    expiresAt: Date
    token: string
    userId: string
    ipAddress?: string | null
    userAgent?: string | null
  }
  user: User
}

export class ApiAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiAuthError'
  }
}

async function findSessionUser(userId: string): Promise<User | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })
  return user ?? null
}

async function loadSessionWithUser(requestHeaders: Headers): Promise<RequiredSession | null> {
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session) return null

  // Better Auth only returns its own base fields in session.user.
  // Fetch the full user row from DB to get our extended fields
  // (organisationId, role, isActive, twoFactorEnabled).
  const user = await findSessionUser(session.user.id)
  if (!user) return null

  return {
    session: session.session as RequiredSession['session'],
    user,
  }
}

export async function getRequiredSession(): Promise<RequiredSession> {
  const session = await loadSessionWithUser(await headers())
  if (!session) redirect('/login')

  try {
    requireActiveUser(session.user)
  } catch {
    redirect('/login')
  }

  return session
}

export async function getApiSession(requestHeaders?: Headers): Promise<RequiredSession> {
  const session = await loadSessionWithUser(requestHeaders ?? await headers())
  if (!session) {
    throw new ApiAuthError(401, 'Unauthorized')
  }

  try {
    requireActiveUser(session.user)
  } catch {
    throw new ApiAuthError(403, 'Forbidden')
  }

  return session
}

export async function getApiOrgSession(
  requestHeaders?: Headers,
): Promise<RequiredSession & { user: User & { organisationId: string } }> {
  const session = await getApiSession(requestHeaders)
  if (!session.user.organisationId) {
    throw new ApiAuthError(403, 'Forbidden')
  }

  return session as RequiredSession & { user: User & { organisationId: string } }
}

export async function getApiOrgAdminSession(
  requestHeaders?: Headers,
): Promise<RequiredSession & { user: User & { organisationId: string } }> {
  const session = await getApiOrgSession(requestHeaders)

  try {
    requireOrgAdmin(session.user, session.user.organisationId)
  } catch {
    throw new ApiAuthError(403, 'Forbidden')
  }

  return session
}
