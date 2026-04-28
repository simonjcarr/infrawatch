import { requireOrgAdmin, requireSameOrg } from '../auth/guards.ts'

export type OrgScopedUser = {
  organisationId: string | null
  isActive: boolean
  deletedAt: Date | null
}

export type OrgAdminScopedUser = OrgScopedUser & {
  role: string
}

export function assertOrgAccess(user: OrgScopedUser, orgId: string): void {
  requireSameOrg(user, orgId)
}

export function assertOrgAdminAccess(user: OrgAdminScopedUser, orgId: string): void {
  requireOrgAdmin(user, orgId)
}
