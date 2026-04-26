export type OrgScopedUser = {
  organisationId: string | null
  isActive: boolean
  deletedAt: Date | null
}

export function assertOrgAccess(user: OrgScopedUser, orgId: string): void {
  if (!user.isActive || user.deletedAt) {
    throw new Error('forbidden: inactive user')
  }

  if (user.organisationId !== orgId) {
    throw new Error('forbidden: organisation mismatch')
  }
}
