import type { User } from '@/lib/db/schema'

type RedirectUser = Pick<User, 'organisationId' | 'isActive' | 'deletedAt'>

export const EXPIRED_SESSION_LOGIN_PATH = '/login?session=expired'

export function shouldBypassAuthenticatedRedirect(searchParams: Record<string, string | string[] | undefined>): boolean {
  const value = searchParams.session
  const session = Array.isArray(value) ? value[0] : value
  return session === 'expired'
}

export function getAuthenticatedRedirectPath(user: RedirectUser | null | undefined): '/dashboard' | '/onboarding' | null {
  if (!user?.isActive || user.deletedAt) {
    return null
  }

  return user.organisationId ? '/dashboard' : '/onboarding'
}
