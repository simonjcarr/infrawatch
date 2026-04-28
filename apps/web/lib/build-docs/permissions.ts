import type { SessionUser } from '@/lib/auth/session'
import { ADMIN_ROLES } from '@/lib/auth/roles'

export function canManageBuildDocAdministration(user: SessionUser): boolean {
  return ADMIN_ROLES.includes(user.role)
}

export function canWriteBuildDocs(user: SessionUser): boolean {
  return user.role !== 'read_only' && user.role !== 'pending'
}

export function canReadBuildDocs(user: SessionUser): boolean {
  return user.role !== 'pending'
}
