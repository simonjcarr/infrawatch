import { requireRole } from '../auth/guards.ts'
import type { SessionUser } from '../auth/session.ts'

export function assertAgentCAManagementAccess(user: Pick<SessionUser, 'role'> & Partial<Pick<SessionUser, 'roles'>>): void {
  requireRole(user, 'super_admin', 'forbidden: super_admin role required')
}
