import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, accounts, sessions, ldapConfigurations } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { authenticateUser } from '@/lib/ldap/client'
import { createId } from '@paralleldrive/cuid2'
import { randomBytes } from 'crypto'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { username, password } = body as { username?: string; password?: string }

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
  }

  // Find all enabled LDAP configs that allow login
  const configs = await db.query.ldapConfigurations.findMany({
    where: and(
      eq(ldapConfigurations.enabled, true),
      eq(ldapConfigurations.allowLogin, true),
      isNull(ldapConfigurations.deletedAt),
    ),
  })

  if (configs.length === 0) {
    return NextResponse.json({ error: 'LDAP login is not configured' }, { status: 400 })
  }

  // Try each config until one succeeds
  for (const config of configs) {
    const result = await authenticateUser(config, username, password)
    if ('error' in result) continue

    const ldapUser = result.user
    const ldapDn = ldapUser.dn

    // Find existing account linked to this LDAP DN
    const existingAccount = await db.query.accounts.findFirst({
      where: and(
        eq(accounts.providerId, 'ldap'),
        eq(accounts.accountId, ldapDn),
      ),
    })

    let userId: string

    if (existingAccount) {
      userId = existingAccount.userId

      // Update user info from LDAP
      await db
        .update(users)
        .set({
          name: ldapUser.displayName ?? ldapUser.username,
          ...(ldapUser.email ? { email: ldapUser.email } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
    } else {
      // Check if a user with this email already exists (merge case)
      const existingUser = ldapUser.email
        ? await db.query.users.findFirst({
            where: eq(users.email, ldapUser.email),
          })
        : null

      if (existingUser) {
        userId = existingUser.id
      } else {
        // Create new user
        userId = createId()
        const email = ldapUser.email ?? `${ldapUser.username}@ldap.local`

        // Find the org from the LDAP config
        await db.insert(users).values({
          id: userId,
          name: ldapUser.displayName ?? ldapUser.username,
          email,
          emailVerified: true,
          organisationId: config.organisationId,
          role: 'engineer',
        })
      }

      // Create account link
      await db.insert(accounts).values({
        accountId: ldapDn,
        providerId: 'ldap',
        userId,
      })
    }

    // Verify user is active
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    })
    if (!user || !user.isActive || user.deletedAt) {
      return NextResponse.json({ error: 'Account is disabled' }, { status: 403 })
    }

    // Create session
    const sessionToken = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    await db.insert(sessions).values({
      token: sessionToken,
      userId,
      expiresAt,
      ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    })

    // Set session cookie (matching Better Auth cookie format)
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    })

    response.cookies.set('better-auth.session_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    })

    return response
  }

  return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
}
