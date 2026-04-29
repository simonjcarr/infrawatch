import { hasRole } from './guards.ts'
import { MEMBERSHIP_ROLES } from './roles.ts'
import type { SessionUser } from './session.ts'

export function canAccessTooling(user: Pick<SessionUser, 'role'> & Partial<Pick<SessionUser, 'roles'>>): boolean {
  return hasRole(user, MEMBERSHIP_ROLES)
}

export function requireToolingAccess(user: Pick<SessionUser, 'role'> & Partial<Pick<SessionUser, 'roles'>>): void {
  if (!canAccessTooling(user)) {
    throw new Error('forbidden: tooling role required')
  }
}
