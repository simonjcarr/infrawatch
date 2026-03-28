import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { User } from '@/lib/db/schema'

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

export async function getRequiredSession(): Promise<RequiredSession> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  // Better Auth only returns its own base fields in session.user.
  // Fetch the full user row from DB to get our extended fields
  // (organisationId, role, isActive, twoFactorEnabled).
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })

  if (!user) redirect('/login')

  return {
    session: session.session as RequiredSession['session'],
    user,
  }
}
