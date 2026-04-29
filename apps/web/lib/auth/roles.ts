export const ASSIGNED_ROLES = ['super_admin', 'org_admin', 'engineer', 'read_only'] as const
export const INVITABLE_ROLES = ['org_admin', 'engineer', 'read_only'] as const

export type AssignedRole = (typeof ASSIGNED_ROLES)[number]
export type LegacyRole = AssignedRole | 'pending'
export type AdminRole = 'org_admin' | 'super_admin'
export type MembershipRole = 'org_admin' | 'super_admin' | 'engineer'

export const ADMIN_ROLES: readonly string[] = ['org_admin', 'super_admin']
export const MEMBERSHIP_ROLES: readonly string[] = ['org_admin', 'super_admin', 'engineer']
export const DEFAULT_NOTIFICATION_ROLES: readonly string[] = ['super_admin', 'org_admin', 'engineer']

export function isAssignedRole(value: string): value is AssignedRole {
  return ASSIGNED_ROLES.includes(value as AssignedRole)
}

export function normalizeAssignedRoles(
  roles: readonly string[] | null | undefined,
  fallbackRole?: string | null,
): AssignedRole[] {
  const values = new Set<AssignedRole>()

  for (const role of roles ?? []) {
    if (isAssignedRole(role)) {
      values.add(role)
    }
  }

  if (values.size === 0 && fallbackRole && isAssignedRole(fallbackRole)) {
    values.add(fallbackRole)
  }

  return ASSIGNED_ROLES.filter((role) => values.has(role))
}

export function getPrimaryRole(
  roles: readonly string[] | null | undefined,
  fallbackRole?: string | null,
): LegacyRole {
  const normalizedRoles = normalizeAssignedRoles(roles, fallbackRole)
  const primaryRole = normalizedRoles[0]
  if (primaryRole) {
    return primaryRole
  }

  if (fallbackRole === 'pending') {
    return 'pending'
  }

  return 'read_only'
}
