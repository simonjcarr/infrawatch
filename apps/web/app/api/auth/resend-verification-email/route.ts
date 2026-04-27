import { NextRequest, NextResponse } from 'next/server'
import { createEmailVerificationToken } from 'better-auth/api'
import { verifyPassword } from 'better-auth/crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { accounts, users } from '@/lib/db/schema'
import { getBetterAuthSecret, getBetterAuthUrl, getRequireEmailVerification } from '@/lib/auth/env'
import { sendVerificationEmail } from '@/lib/auth/email'
import {
  EMAIL_VERIFICATION_RESEND_INVALID_MESSAGE,
  EMAIL_VERIFICATION_RESEND_SENT_MESSAGE,
  createVerificationEmailUrl,
  getVerificationResendClientIp,
  normalizeVerificationEmail,
  sanitizeVerificationCallbackPath,
} from '@/lib/auth/email-verification-resend'
import {
  EMAIL_VERIFICATION_RESEND_THROTTLED_MESSAGE,
  emailVerificationResendPolicy,
} from '@/lib/auth/email-verification-rate-limit'
import { passwordLoginAttemptGuard } from '@/lib/auth/login-attempts'

const resendSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  callbackURL: z.unknown().optional(),
})

async function withAuthDelay<T>(start: number, value: T): Promise<T> {
  const minMs = 350 + Math.floor(Math.random() * 150)
  const elapsed = Date.now() - start
  if (elapsed < minMs) await new Promise((resolve) => setTimeout(resolve, minMs - elapsed))
  return value
}

function invalidResponse() {
  return NextResponse.json({ message: EMAIL_VERIFICATION_RESEND_INVALID_MESSAGE }, { status: 401 })
}

export async function POST(request: NextRequest) {
  const requestStart = Date.now()
  const ip = getVerificationResendClientIp(request)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = resendSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'Email and password are required.' }, { status: 400 })
  }

  const email = normalizeVerificationEmail(parsed.data.email)
  if (!emailVerificationResendPolicy.check({ email, ip })) {
    return NextResponse.json(
      { message: EMAIL_VERIFICATION_RESEND_THROTTLED_MESSAGE },
      { status: 429 },
    )
  }

  const accountStatus = passwordLoginAttemptGuard.check(email)
  if (!accountStatus.allowed) {
    return NextResponse.json(
      { message: 'Too many login attempts — please wait before trying again.' },
      { status: 429 },
    )
  }

  if (!getRequireEmailVerification()) {
    return NextResponse.json({ message: EMAIL_VERIFICATION_RESEND_SENT_MESSAGE })
  }

  const [row] = await db
    .select({ user: users, account: accounts })
    .from(users)
    .innerJoin(accounts, eq(accounts.userId, users.id))
    .where(
      and(
        eq(users.email, email),
        eq(accounts.providerId, 'credential'),
        isNull(users.deletedAt),
      ),
    )
    .limit(1)

  const user = row?.user
  const account = row?.account
  const passwordHash = account?.password
  if (!user || !passwordHash) {
    await verifyPassword({
      hash: '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      password: parsed.data.password,
    }).catch(() => undefined)
    passwordLoginAttemptGuard.recordFailure(email)
    return withAuthDelay(requestStart, invalidResponse())
  }

  const passwordMatches = await verifyPassword({
    hash: passwordHash,
    password: parsed.data.password,
  })

  if (!passwordMatches) {
    passwordLoginAttemptGuard.recordFailure(email)
    return withAuthDelay(requestStart, invalidResponse())
  }

  passwordLoginAttemptGuard.reset(email)

  if (user.emailVerified || !user.isActive) {
    return withAuthDelay(
      requestStart,
      NextResponse.json({ message: EMAIL_VERIFICATION_RESEND_SENT_MESSAGE }),
    )
  }

  const callbackPath = sanitizeVerificationCallbackPath(parsed.data.callbackURL)
  const token = await createEmailVerificationToken(getBetterAuthSecret(), user.email)
  const verificationUrl = createVerificationEmailUrl({
    baseUrl: getBetterAuthUrl(),
    token,
    callbackPath,
  })

  await sendVerificationEmail({
    email: user.email,
    name: user.name,
    verificationUrl,
  })

  return withAuthDelay(
    requestStart,
    NextResponse.json({ message: EMAIL_VERIFICATION_RESEND_SENT_MESSAGE }),
  )
}
