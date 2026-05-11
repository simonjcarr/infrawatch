import type { User } from '@/lib/db/schema'

type RedirectUser = Pick<User, 'isActive' | 'deletedAt' | 'role'>

export const EXPIRED_SESSION_LOGIN_PATH = '/login?session=expired'

export function shouldBypassAuthenticatedRedirect(searchParams: Record<string, string | string[] | undefined>): boolean {
  const value = searchParams.session
  const session = Array.isArray(value) ? value[0] : value
  return session === 'expired'
}

export function getAuthenticatedRedirectPath(user: RedirectUser | null | undefined): '/dashboard' | '/pending-approval' | null {
  if (!user?.isActive || user.deletedAt) {
    return null
  }

  if (user.role === 'pending') {
    return '/pending-approval'
  }

  return '/dashboard'
}
