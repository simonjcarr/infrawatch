export const EMAIL_VERIFICATION_RESEND_THROTTLED_MESSAGE =
  'Too many verification emails requested. Please wait a minute before trying again.'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase()
}

function recentHits(
  requestLog: Map<string, number[]>,
  key: string,
  windowMs: number,
  now: number,
): { normalized: string; hits: number[] } {
  const normalized = normalizeIdentifier(key)
  if (!normalized) return { normalized, hits: [] }

  const cutoff = now - windowMs
  return {
    normalized,
    hits: (requestLog.get(normalized) ?? []).filter((timestamp) => timestamp > cutoff),
  }
}

function recordHit(requestLog: Map<string, number[]>, normalized: string, hits: number[], now: number) {
  if (!normalized) return
  hits.push(now)
  requestLog.set(normalized, hits)
}

export function createEmailVerificationResendGuard(windowMs: number, maxRequests: number) {
  const requestLog = new Map<string, number[]>()

  return {
    check(email: string, now = Date.now()): boolean {
      const emailHits = recentHits(requestLog, normalizeEmail(email), windowMs, now)
      if (emailHits.hits.length >= maxRequests) return false

      recordHit(requestLog, emailHits.normalized, emailHits.hits, now)
      return true
    },
  }
}

export function createEmailVerificationResendPolicy(options: {
  windowMs: number
  maxRequestsPerEmail: number
  maxRequestsPerIp: number
}) {
  const emailRequests = new Map<string, number[]>()
  const ipRequests = new Map<string, number[]>()

  return {
    check(input: { email: string; ip: string }, now = Date.now()): boolean {
      const emailHits = recentHits(emailRequests, normalizeEmail(input.email), options.windowMs, now)
      const ipHits = recentHits(ipRequests, input.ip, options.windowMs, now)

      if (
        emailHits.hits.length >= options.maxRequestsPerEmail ||
        ipHits.hits.length >= options.maxRequestsPerIp
      ) {
        return false
      }

      recordHit(emailRequests, emailHits.normalized, emailHits.hits, now)
      recordHit(ipRequests, ipHits.normalized, ipHits.hits, now)
      return true
    },
  }
}

export const emailVerificationResendPolicy = createEmailVerificationResendPolicy({
  windowMs: 60_000,
  maxRequestsPerEmail: 3,
  maxRequestsPerIp: 10,
})
