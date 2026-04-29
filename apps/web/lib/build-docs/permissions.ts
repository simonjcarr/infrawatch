import type { SessionUser } from '@/lib/auth/session'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { canAccessTooling } from '@/lib/auth/tooling'

export function canManageBuildDocAdministration(user: SessionUser): boolean {
  return ADMIN_ROLES.includes(user.role)
}

export function canWriteBuildDocs(user: SessionUser): boolean {
  return canAccessTooling(user)
}

export function canReadBuildDocs(user: SessionUser): boolean {
  return canAccessTooling(user)
}
