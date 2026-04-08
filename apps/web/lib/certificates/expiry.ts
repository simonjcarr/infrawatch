import type { CertificateStatus } from '@/lib/db/schema'

/**
 * Compute the certificate status based on its expiry date.
 * @param notAfter - The certificate's expiry date.
 * @param warnDays - Days before expiry to enter expiring_soon state (default 30).
 */
export function computeExpiryStatus(notAfter: Date, warnDays = 30): CertificateStatus {
  const now = new Date()
  if (notAfter <= now) return 'expired'
  const warnDate = new Date(now.getTime() + warnDays * 24 * 60 * 60 * 1000)
  if (notAfter <= warnDate) return 'expiring_soon'
  return 'valid'
}

/**
 * Format a human-readable countdown string for a certificate's expiry.
 * e.g. "in 23 days", "expired 4 days ago", "expires today"
 */
export function formatDaysUntil(date: Date): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'expires today'
  if (diffDays > 0) return `in ${diffDays} day${diffDays === 1 ? '' : 's'}`
  const absDays = Math.abs(diffDays)
  return `expired ${absDays} day${absDays === 1 ? '' : 's'} ago`
}
