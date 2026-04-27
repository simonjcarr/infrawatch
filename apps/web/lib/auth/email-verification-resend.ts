export const EMAIL_VERIFICATION_RESEND_INVALID_MESSAGE =
  'We could not resend a verification email. Check your email and password, then try again.'

export const EMAIL_VERIFICATION_RESEND_SENT_MESSAGE =
  'Verification email sent. Check your inbox for the new link.'

export function normalizeVerificationEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function getVerificationResendClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

export function sanitizeVerificationCallbackPath(value: unknown): string {
  if (typeof value !== 'string') return '/dashboard'

  const trimmed = value.trim()
  if (
    trimmed.length === 0 ||
    trimmed.length > 256 ||
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    /[\r\n]/.test(trimmed)
  ) {
    return '/dashboard'
  }

  return trimmed
}

export function createVerificationEmailUrl(input: {
  baseUrl: string
  token: string
  callbackPath: string
}): string {
  const url = new URL('/verify-email', input.baseUrl)
  url.searchParams.set('token', input.token)
  url.searchParams.set('callbackURL', input.callbackPath)
  return url.toString()
}
