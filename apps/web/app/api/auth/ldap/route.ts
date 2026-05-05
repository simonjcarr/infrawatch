import { logError } from '@/lib/logging'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, accounts, sessions, ldapConfigurations, verifications, organisations } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { authenticateUser } from '@/lib/ldap/client'
import { createId } from '@paralleldrive/cuid2'
import { randomBytes } from 'crypto'
import { createRateLimiter } from '@/lib/rate-limit'
import { getBetterAuthSecret } from '@/lib/auth/env'
import { passwordLoginAttemptGuard } from '@/lib/auth/login-attempts'
import { makeSessionCookieValue } from '@/lib/auth/session-cookie'
import { normalizeLdapTenantSlug } from '@/lib/auth/ldap-tenant'
import { getClientIpFromHeaders } from '@/lib/client-ip'
import { assertCanReserveUserSeat, toSeatLimitErrorMessage } from '@/lib/actions/seat-enforcement'
import { SeatAdmissionError, assertUserCanAccessSeat } from '@/lib/seat-admission'
import {
  createSignedLdapTwoFactorCookieValue,
  LDAP_TWO_FACTOR_CHALLENGE_TTL_MS,
  LDAP_TWO_FACTOR_COOKIE_NAME,
  serialiseLdapTwoFactorChallenge,
} from '@/lib/auth/ldap-two-factor'

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
    const ip = getClientIpFromHeaders(request.headers)

    if (!await ldapRateLimit.check(ip)) {
      return NextResponse.json(
        { error: 'Too many login attempts — please wait before trying again.' },
        { status: 429 },
      )
    }

    const body = await request.json()
    const { username, password, organisationSlug } = body as {
      username?: string
      password?: string
      organisationSlug?: string
    }
    const tenantSlug = normalizeLdapTenantSlug(organisationSlug)

    const authSecret = getBetterAuthSecret()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    if (!tenantSlug) {
      return NextResponse.json({ error: 'Organisation slug is required' }, { status: 400 })
    }

    const accountKey = `${tenantSlug}:${username}`
    const accountStatus = await passwordLoginAttemptGuard.check(accountKey)
    if (!accountStatus.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts — please wait before trying again.' },
        { status: 429 },
      )
    }

    const organisation = await db.query.organisations.findFirst({
      where: and(
        eq(organisations.slug, tenantSlug),
        isNull(organisations.deletedAt),
      ),
      columns: { id: true },
    })
    if (!organisation) {
      return NextResponse.json({ error: 'LDAP login is not configured for this organisation' }, { status: 400 })
    }

    // Authenticate only against the tenant explicitly selected by the caller.
    const configs = await db.query.ldapConfigurations.findMany({
      where: and(
        eq(ldapConfigurations.organisationId, organisation.id),
        eq(ldapConfigurations.enabled, true),
        eq(ldapConfigurations.allowLogin, true),
        isNull(ldapConfigurations.deletedAt),
      ),
    })

    if (configs.length === 0) {
      return NextResponse.json({ error: 'LDAP login is not configured for this organisation' }, { status: 400 })
    }

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
        await passwordLoginAttemptGuard.recordFailure(accountKey)
        return withAuthDelay(
          requestStart,
          NextResponse.json({ error: 'Invalid credentials' }, { status: 401 }),
        )
      }

      await assertUserCanAccessSeat(user.organisationId!, user.id)

      if (user.twoFactorEnabled) {
        const challengeId = `ldap-2fa-${createId()}`
        const expiresAt = new Date(Date.now() + LDAP_TWO_FACTOR_CHALLENGE_TTL_MS)
        const signedChallenge = await createSignedLdapTwoFactorCookieValue(challengeId, authSecret)

        await db.insert(verifications).values({
          identifier: challengeId,
          value: serialiseLdapTwoFactorChallenge({
            userId: user.id,
            username,
          }),
          expiresAt,
        })

        const challengeResponse = NextResponse.json({
          twoFactorRequired: true,
          methods: ['totp', 'backup_code'],
        })
        challengeResponse.cookies.set(LDAP_TWO_FACTOR_COOKIE_NAME, signedChallenge, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          expires: expiresAt,
        })

        return withAuthDelay(requestStart, challengeResponse)
      }

      const sessionToken = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

      await db.insert(sessions).values({
        token: sessionToken,
        userId,
        expiresAt,
        ipAddress: ip === 'unknown' ? null : ip,
        userAgent: request.headers.get('user-agent') ?? null,
      })

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

      await passwordLoginAttemptGuard.reset(accountKey)
      return withAuthDelay(requestStart, response)
    }

    logError(`[LDAP] All configs failed for user "${username}":`, errors)
    await passwordLoginAttemptGuard.recordFailure(accountKey)
    return withAuthDelay(
      requestStart,
      NextResponse.json({ error: 'Invalid credentials' }, { status: 401 }),
    )
  } catch (err) {
    if (err instanceof SeatAdmissionError) {
      return withAuthDelay(
        requestStart,
        NextResponse.json({ error: 'User seat limit exceeded' }, { status: 403 }),
      )
    }
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
