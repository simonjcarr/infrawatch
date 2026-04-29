import { logError } from '@/lib/logging'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, accounts, sessions, ldapConfigurations } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { authenticateUser } from '@/lib/ldap/client'
import { createId } from '@paralleldrive/cuid2'
import { randomBytes } from 'crypto'
import { createRateLimiter } from '@/lib/rate-limit'
import { getBetterAuthSecret } from '@/lib/auth/env'
import { passwordLoginAttemptGuard } from '@/lib/auth/login-attempts'
import { makeSessionCookieValue } from '@/lib/auth/session-cookie'
import { assertCanReserveUserSeat, toSeatLimitErrorMessage } from '@/lib/actions/seat-enforcement'

// 5 attempts per IP per 60 seconds — prevents brute-force and user enumeration
const ldapRateLimit = createRateLimiter({
  scope: 'auth:ldap',
  windowMs: 60_000,
  max: 5,
})

// Enforce a minimum response time for all auth outcomes to resist timing-based
// user enumeration. A valid user that proceeds through DB operations takes longer
// than an invalid one that fails at LDAP search; the floor + jitter narrows that gap.
async function withAuthDelay<T>(start: number, value: T): Promise<T> {
  const minMs = 400 + Math.floor(Math.random() * 200) // 400–600 ms
  const elapsed = Date.now() - start
  if (elapsed < minMs) await new Promise((r) => setTimeout(r, minMs - elapsed))
  return value
}

export async function POST(request: NextRequest) {
  const requestStart = Date.now()

  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? 'unknown'

    if (!await ldapRateLimit.check(ip)) {
      return NextResponse.json(
        { error: 'Too many login attempts — please wait before trying again.' },
        { status: 429 },
      )
    }

    const body = await request.json()
    const { username, password } = body as { username?: string; password?: string }

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    const accountStatus = await passwordLoginAttemptGuard.check(username)
    if (!accountStatus.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts — please wait before trying again.' },
        { status: 429 },
      )
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
    const errors: string[] = []
    for (const config of configs) {
      const result = await authenticateUser(config, username, password)
      if ('error' in result) {
        console.error(`[LDAP] Auth failed for config "${config.name}" (${config.host}): ${result.error}`)
        errors.push(`${config.name}: ${result.error}`)
        continue
      }

      const ldapUser = result.user
      const ldapDn = ldapUser.dn

      // Find existing account linked to this LDAP DN for this LDAP config's org.
      let userId: string
      const [linkedAccount] = await db
        .select({ user: users })
        .from(accounts)
        .innerJoin(users, eq(accounts.userId, users.id))
        .where(
          and(
            eq(accounts.providerId, 'ldap'),
            eq(accounts.accountId, ldapDn),
            eq(users.organisationId, config.organisationId),
            isNull(users.deletedAt),
          ),
        )
        .limit(1)
      const linkedUser = linkedAccount?.user ?? null

      if (linkedUser) {
        userId = linkedUser.id

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
        // Check if a user with this email already exists in this LDAP config's org.
        const existingUser = ldapUser.email
          ? await db.query.users.findFirst({
              where: and(
                eq(users.email, ldapUser.email),
                eq(users.organisationId, config.organisationId),
                isNull(users.deletedAt),
              ),
            })
          : null

        if (existingUser) {
          userId = existingUser.id
        } else {
          // Create new user
          await assertCanReserveUserSeat(config.organisationId)
          userId = createId()
          const email = ldapUser.email || `${ldapUser.username}@ldap.local`

          // Find the org from the LDAP config
          await db.insert(users).values({
            id: userId,
            name: ldapUser.displayName ?? ldapUser.username,
            email,
            emailVerified: true,
            organisationId: config.organisationId,
            role: 'pending',
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
        // Log internally but return the same generic error to avoid leaking account existence.
        console.warn(`[LDAP] Login rejected — account inactive or deleted: userId=${userId}`)
        await passwordLoginAttemptGuard.recordFailure(username)
        return withAuthDelay(
          requestStart,
          NextResponse.json({ error: 'Invalid credentials' }, { status: 401 }),
        )
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

      const authSecret = getBetterAuthSecret()
      const cookieValue = await makeSessionCookieValue(sessionToken, authSecret)

      const response = NextResponse.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      })

      // Set the cookie with an already-encoded value (Next.js would double-encode otherwise).
      response.headers.append(
        'Set-Cookie',
        `better-auth.session_token=${cookieValue}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}; Expires=${expiresAt.toUTCString()}`,
      )

      await passwordLoginAttemptGuard.reset(username)
      return withAuthDelay(requestStart, response)
    }

    logError(`[LDAP] All configs failed for user "${username}":`, errors)
    await passwordLoginAttemptGuard.recordFailure(username)
    return withAuthDelay(
      requestStart,
      NextResponse.json({ error: 'Invalid credentials' }, { status: 401 }),
    )
  } catch (err) {
    const seatLimitMessage = toSeatLimitErrorMessage(err)
    if (seatLimitMessage) {
      return withAuthDelay(
        requestStart,
        NextResponse.json({ error: seatLimitMessage }, { status: 403 }),
      )
    }
    logError('[LDAP] Unexpected error during login:', err)
    return withAuthDelay(
      requestStart,
      NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 }),
    )
  }
}
