export const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
  '__Host-better-auth.session_token',
] as const

type CookieReader = {
  get(name: string): { value?: string } | undefined
}

export function hasBetterAuthSessionCookie(cookies: CookieReader): boolean {
  return SESSION_COOKIE_NAMES.some((name) => !!cookies.get(name)?.value)
}
