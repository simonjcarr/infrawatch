import { logError } from '@/lib/logging'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sessions, totpCredentials, users, verifications } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { createRateLimiter } from '@/lib/rate-limit'
import { getBetterAuthSecret, getBetterAuthUrl } from '@/lib/auth/env'
import { passwordLoginAttemptGuard } from '@/lib/auth/login-attempts'
import {
  getBetterAuthSessionCookieName,
  makeSessionCookieValue,
  shouldUseSecureSessionCookie,
} from '@/lib/auth/session-cookie'
import { assertUserCanAccessSeat, SeatAdmissionError } from '@/lib/seat-admission'
import { getClientIpFromHeaders } from '@/lib/client-ip'
import {
  encryptLdapBackupCodes,
  LDAP_TWO_FACTOR_COOKIE_NAME,
  parseLdapTwoFactorChallenge,
  readSignedLdapTwoFactorCookieValue,
  type LdapTwoFactorMethod,
  verifyLdapTwoFactorCode,
} from '@/lib/auth/ldap-two-factor'
import { toSeatLimitErrorMessage } from '@/lib/actions/seat-enforcement'

const ldapTwoFactorRateLimit = createRateLimiter({
  scope: 'auth:ldap:2fa',
  windowMs: 60_000,
  max: 10,
})

async function withAuthDelay<T>(start: number, value: T): Promise<T> {
  const minMs = 400 + Math.floor(Math.random() * 200)
  const elapsed = Date.now() - start
  if (elapsed < minMs) await new Promise((resolve) => setTimeout(resolve, minMs - elapsed))
  return value
}

export async function POST(request: NextRequest) {
  const requestStart = Date.now()

  try {
    const ip = getClientIpFromHeaders(request.headers)

    if (!await ldapTwoFactorRateLimit.check(ip)) {
      return NextResponse.json(
        { error: 'Too many login attempts — please wait before trying again.' },
        { status: 429 },
      )
    }

    const body = await request.json() as {
      twoFactorCode?: string
      twoFactorMethod?: LdapTwoFactorMethod
    }
    const twoFactorCode = typeof body.twoFactorCode === 'string' ? body.twoFactorCode : ''
    const twoFactorMethod = body.twoFactorMethod

    const authSecret = getBetterAuthSecret()
    const authUrl = getBetterAuthUrl()
    const signedChallengeCookie = request.cookies.get(LDAP_TWO_FACTOR_COOKIE_NAME)?.value
    const challengeId = await readSignedLdapTwoFactorCookieValue(signedChallengeCookie, authSecret)

    if (!challengeId) {
      return withAuthDelay(
        requestStart,
        NextResponse.json({ error: 'Two-factor verification session expired. Please sign in again.' }, { status: 401 }),
      )
    }

    const challengeRecord = await db.query.verifications.findFirst({
      where: eq(verifications.identifier, challengeId),
    })

    if (!challengeRecord || challengeRecord.expiresAt <= new Date()) {
      if (challengeRecord) {
        await db.delete(verifications).where(eq(verifications.identifier, challengeId))
      }

      const expiredResponse = NextResponse.json(
        { error: 'Two-factor verification session expired. Please sign in again.' },
        { status: 401 },
      )
      expiredResponse.cookies.set(LDAP_TWO_FACTOR_COOKIE_NAME, '', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        expires: new Date(0),
      })
      return withAuthDelay(requestStart, expiredResponse)
    }

    const challenge = parseLdapTwoFactorChallenge(challengeRecord.value)
    if (!challenge) {
      await db.delete(verifications).where(eq(verifications.identifier, challengeId))
      return withAuthDelay(
        requestStart,
        NextResponse.json({ error: 'Two-factor verification session expired. Please sign in again.' }, { status: 401 }),
      )
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, challenge.userId),
    })
    if (!user || !user.isActive || user.deletedAt || !user.twoFactorEnabled) {
      await db.delete(verifications).where(eq(verifications.identifier, challengeId))
      return withAuthDelay(
        requestStart,
        NextResponse.json({ error: 'Invalid credentials' }, { status: 401 }),
      )
    }

    await assertUserCanAccessSeat(user.instanceId!, user.id)

    const credential = await db.query.totpCredentials.findFirst({
      where: eq(totpCredentials.userId, user.id),
    })
    if (!credential) {
      await db.delete(verifications).where(eq(verifications.identifier, challengeId))
      return withAuthDelay(
        requestStart,
        NextResponse.json({ error: 'Two-factor authentication is not configured for this account.' }, { status: 403 }),
      )
    }

    const verification = await verifyLdapTwoFactorCode({
      credential,
      method: twoFactorMethod === 'backup_code' ? 'backup_code' : 'totp',
      code: twoFactorCode,
      secret: authSecret,
      digits: 6,
      period: 30,
    })

    if (!verification.ok) {
      return withAuthDelay(
        requestStart,
        NextResponse.json({ error: 'Invalid two-factor code' }, { status: 401 }),
      )
    }

    if (verification.backupCode) {
      await db
        .update(totpCredentials)
        .set({
          backupCodes: await encryptLdapBackupCodes(verification.backupCode.remainingCodes, authSecret),
          updatedAt: new Date(),
        })
        .where(eq(totpCredentials.id, credential.id))
    }

    const sessionToken = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    await db.insert(sessions).values({
      token: sessionToken,
      userId: user.id,
      expiresAt,
      ipAddress: ip === 'unknown' ? null : ip,
      userAgent: request.headers.get('user-agent') ?? null,
    })

    const cookieValue = await makeSessionCookieValue(sessionToken, authSecret)
    const cookieName = getBetterAuthSessionCookieName(authUrl)
    const secureCookie = shouldUseSecureSessionCookie(authUrl)
    await db.delete(verifications).where(eq(verifications.identifier, challengeId))
    await passwordLoginAttemptGuard.reset(challenge.username)

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    })

    response.headers.append(
      'Set-Cookie',
      `${cookieName}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax${secureCookie ? '; Secure' : ''}; Expires=${expiresAt.toUTCString()}`,
    )
    response.cookies.set(LDAP_TWO_FACTOR_COOKIE_NAME, '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: new Date(0),
    })

    return withAuthDelay(requestStart, response)
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
    logError('[LDAP] Unexpected error during two-factor verification:', err)
    return withAuthDelay(
      requestStart,
      NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 }),
    )
  }
}
