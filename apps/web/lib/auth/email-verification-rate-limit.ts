import { createRateLimiter } from '../rate-limit.ts'
import type { ThrottleStore } from '../throttle-store.ts'

export const EMAIL_VERIFICATION_RESEND_THROTTLED_MESSAGE =
  'Too many verification emails requested. Please wait a minute before trying again.'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase()
}

export function createEmailVerificationResendGuard(
  windowMs: number,
  maxRequests: number,
  store?: ThrottleStore,
) {
  const limiter = createRateLimiter({
    scope: 'auth:verification-resend:email',
    windowMs,
    max: maxRequests,
    store,
  })

  return {
    async check(email: string, now = Date.now()): Promise<boolean> {
      return limiter.check(normalizeEmail(email), now)
    },
  }
}

export function createEmailVerificationResendPolicy(options: {
  windowMs: number
  maxRequestsPerEmail: number
  maxRequestsPerIp: number
  store?: ThrottleStore
}) {
  const emailLimiter = createRateLimiter({
    scope: 'auth:verification-resend:email',
    windowMs: options.windowMs,
    max: options.maxRequestsPerEmail,
    store: options.store,
  })
  const ipLimiter = createRateLimiter({
    scope: 'auth:verification-resend:ip',
    windowMs: options.windowMs,
    max: options.maxRequestsPerIp,
    store: options.store,
  })

  return {
    async check(input: { email: string; ip: string }, now = Date.now()): Promise<boolean> {
      const normalizedEmail = normalizeEmail(input.email)
      const normalizedIp = normalizeIdentifier(input.ip)
      if (!normalizedEmail || !normalizedIp) return false

      const emailAllowed = await emailLimiter.check(normalizedEmail, now)
      if (!emailAllowed) return false
      return ipLimiter.check(normalizedIp, now)
    },
  }
}

export const emailVerificationResendPolicy = createEmailVerificationResendPolicy({
  windowMs: 60_000,
  maxRequestsPerEmail: 3,
  maxRequestsPerIp: 10,
})
