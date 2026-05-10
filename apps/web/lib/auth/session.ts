import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { asc, eq } from 'drizzle-orm'
import type { User } from '@/lib/db/schema'
import { requireActiveUser, requireOrgAdmin } from './guards'
import { EXPIRED_SESSION_LOGIN_PATH } from './redirects'
import { getPrimaryRole, normalizeAssignedRoles } from './roles'
import { SEAT_LIMIT_EXCEEDED_PATH, assertUserCanAccessSeat } from '@/lib/seat-admission'
import { organisations } from '@/lib/db/schema'
import { parseOrgMetadata } from '@/lib/db/schema/organisations'
import { getTwoFactorPolicyRedirect } from './two-factor-policy'
import { getDefaultOrganisationId } from '@/lib/default-organisation'

const INSTANCE_ADMIN_ROLE = 'super_admin'

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
  let user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })
  if (!user) return null

  user = await ensureInstanceHasSuperAdmin(user)

  const organisationId = user.organisationId ?? await getDefaultOrganisationId()

  return {
    ...user,
    organisationId,
    role: getPrimaryRole(user.roles, user.role),
    roles: normalizeAssignedRoles(user.roles, user.role),
  }
}

async function ensureInstanceHasSuperAdmin(user: User): Promise<User> {
  if (!user.isActive || user.deletedAt) return user
  if (normalizeAssignedRoles(user.roles, user.role).includes(INSTANCE_ADMIN_ROLE)) return user

  const activeUsers = await db.query.users.findMany({
    where: (table, { eq, and, isNull }) => and(eq(table.isActive, true), isNull(table.deletedAt)),
    columns: { id: true, role: true, roles: true },
    orderBy: [asc(users.createdAt), asc(users.email)],
  })

  const hasSuperAdmin = activeUsers.some((row) =>
    normalizeAssignedRoles(row.roles, row.role).includes(INSTANCE_ADMIN_ROLE),
  )
  if (hasSuperAdmin || activeUsers[0]?.id !== user.id) return user

  const roles = normalizeAssignedRoles([INSTANCE_ADMIN_ROLE])
  const [promoted] = await db
    .update(users)
    .set({ role: INSTANCE_ADMIN_ROLE, roles, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning()

  return promoted ?? { ...user, role: INSTANCE_ADMIN_ROLE, roles }
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

function getRequestPathname(requestHeaders: Headers): string {
  const headerPath = requestHeaders.get('x-pathname')
  if (headerPath?.startsWith('/')) return headerPath

  const referer = requestHeaders.get('referer')
  if (referer) {
    try {
      return new URL(referer).pathname
    } catch {
      return '/'
    }
  }

  return '/'
}

async function getTwoFactorPolicyRedirectForSession(
  session: RequiredSession,
  requestHeaders: Headers,
): Promise<string | null> {
  const organisationId = session.user.organisationId
  if (!organisationId) return null

  const organisation = await db.query.organisations.findFirst({
    where: eq(organisations.id, organisationId),
    columns: { metadata: true },
  })
  if (!organisation) return null

  return getTwoFactorPolicyRedirect({
    metadata: parseOrgMetadata(organisation.metadata),
    userTwoFactorEnabled: session.user.twoFactorEnabled,
    pathname: getRequestPathname(requestHeaders),
  })
}

export async function getRequiredSession(): Promise<RequiredSession> {
  const requestHeaders = await headers()
  const session = await loadSessionWithUser(requestHeaders)
  if (!session) redirect(EXPIRED_SESSION_LOGIN_PATH)

  try {
    requireActiveUser(session.user)
  } catch {
    redirect(EXPIRED_SESSION_LOGIN_PATH)
  }

  if (session.user.organisationId) {
    try {
      await assertUserCanAccessSeat(session.user.organisationId, session.user.id)
    } catch {
      redirect(SEAT_LIMIT_EXCEEDED_PATH)
    }
  }

  const twoFactorRedirect = await getTwoFactorPolicyRedirectForSession(session, requestHeaders)
  if (twoFactorRedirect) redirect(twoFactorRedirect)

  return session
}

export async function getApiSession(requestHeaders?: Headers): Promise<RequiredSession> {
  const effectiveHeaders = requestHeaders ?? await headers()
  const session = await loadSessionWithUser(effectiveHeaders)
  if (!session) {
    throw new ApiAuthError(401, 'Unauthorized')
  }

  try {
    requireActiveUser(session.user)
  } catch {
    throw new ApiAuthError(403, 'Forbidden')
  }

  if (session.user.organisationId) {
    try {
      await assertUserCanAccessSeat(session.user.organisationId, session.user.id)
    } catch {
      throw new ApiAuthError(403, 'User seat limit exceeded')
    }
  }

  const twoFactorRedirect = await getTwoFactorPolicyRedirectForSession(session, effectiveHeaders)
  if (twoFactorRedirect) {
    throw new ApiAuthError(403, 'Two-factor authentication setup required')
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
