export type OrgScopedUser = {
  organisationId: string | null
  isActive: boolean
  deletedAt: Date | null
}

export type OrgAdminScopedUser = OrgScopedUser & {
  role: string
}

export function assertOrgAccess(user: OrgScopedUser, orgId: string): void {
  if (!user.isActive || user.deletedAt) {
    throw new Error('forbidden: inactive user')
  }

  if (user.organisationId !== orgId) {
    throw new Error('forbidden: organisation mismatch')
  }
}

export function assertOrgAdminAccess(user: OrgAdminScopedUser, orgId: string): void {
  assertOrgAccess(user, orgId)

  if (user.role !== 'org_admin' && user.role !== 'super_admin') {
    throw new Error('forbidden: admin role required')
  }
}
