export const DEFAULT_ENROLMENT_TOKEN_MAX_USES = 1
export const DEFAULT_ENROLMENT_TOKEN_EXPIRY_DAYS = 7

export const LEGACY_ENROLMENT_TOKEN_GRACE_EXPIRY_DAYS = 30

export function normaliseEnrolmentTokenLimits(input: {
  maxUses?: number | null
  expiresInDays?: number | null
}) {
  return {
    maxUses: input.maxUses ?? DEFAULT_ENROLMENT_TOKEN_MAX_USES,
    expiresInDays: input.expiresInDays ?? DEFAULT_ENROLMENT_TOKEN_EXPIRY_DAYS,
  }
}

export function calculateEnrolmentTokenExpiry(expiresInDays: number, now = new Date()): Date {
  const expiresAt = new Date(now)
  expiresAt.setDate(expiresAt.getDate() + expiresInDays)
  return expiresAt
}
