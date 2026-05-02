export function getInviteAcceptPath(token: string | null | undefined): string | null {
  const trimmed = token?.trim()
  if (!trimmed || trimmed.length > 256 || /[\r\n]/.test(trimmed)) return null
  return `/accept-invite?token=${encodeURIComponent(trimmed)}`
}

export function getInviteLoginPath(token: string | null | undefined): string {
  const trimmed = token?.trim()
  if (!trimmed || trimmed.length > 256 || /[\r\n]/.test(trimmed)) return '/login'
  return `/login?invite=${encodeURIComponent(trimmed)}`
}

export function getInviteRegisterPath(token: string | null | undefined): string {
  const trimmed = token?.trim()
  if (!trimmed || trimmed.length > 256 || /[\r\n]/.test(trimmed)) return '/register'
  return `/register?invite=${encodeURIComponent(trimmed)}`
}
