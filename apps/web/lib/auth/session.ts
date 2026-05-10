import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { asc, eq } from 'drizzle-orm'
import type { User } from '@/lib/db/schema'
import { requireActiveUser, requireInstanceAdmin } from './guards'
import { EXPIRED_SESSION_LOGIN_PATH } from './redirects'
import { getPrimaryRole, normalizeAssignedRoles } from './roles'
import { SEAT_LIMIT_EXCEEDED_PATH, assertUserCanAccessSeat } from '@/lib/seat-admission'
import { instanceSettings } from '@/lib/db/schema'
import { parseInstanceMetadata } from '@/lib/db/schema/instance-settings'
import { getTwoFactorPolicyRedirect } from './two-factor-policy'
import { getDefaultInstanceId } from '@/lib/default-instance'

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

  const instanceId = user.instanceId ?? await getDefaultInstanceId()

  return {
    ...user,
    instanceId,
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
  // (instanceId, role, isActive, twoFactorEnabled).
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
  const instanceId = session.user.instanceId
  if (!instanceId) return null

  const instance = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })
  if (!instance) return null

  return getTwoFactorPolicyRedirect({
    metadata: parseInstanceMetadata(instance.metadata),
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

  if (session.user.instanceId) {
    try {
      await assertUserCanAccessSeat(session.user.instanceId, session.user.id)
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

  if (session.user.instanceId) {
    try {
      await assertUserCanAccessSeat(session.user.instanceId, session.user.id)
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

export async function getApiInstanceSession(
  requestHeaders?: Headers,
): Promise<RequiredSession & { user: User & { instanceId: string } }> {
  const session = await getApiSession(requestHeaders)
  if (!session.user.instanceId) {
    throw new ApiAuthError(403, 'Forbidden')
  }

  return session as RequiredSession & { user: User & { instanceId: string } }
}

export async function getApiInstanceAdminSession(
  requestHeaders?: Headers,
): Promise<RequiredSession & { user: User & { instanceId: string } }> {
  const session = await getApiInstanceSession(requestHeaders)

  try {
    requireInstanceAdmin(session.user, session.user.instanceId)
  } catch {
    throw new ApiAuthError(403, 'Forbidden')
  }

  return session
}
