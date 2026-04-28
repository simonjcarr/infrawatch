import { ADMIN_ROLES, MEMBERSHIP_ROLES } from './roles.ts'
import type { SessionUser } from './session.ts'

type OrgScopedUser = Pick<SessionUser, 'organisationId' | 'isActive' | 'deletedAt'>
type GuardUser = OrgScopedUser & Pick<SessionUser, 'role'>
type OrgTarget = string | { organisationId: string | null }
type RoleInput = string | readonly string[]

function toOrganisationId(target: OrgTarget): string | null {
  return typeof target === 'string' ? target : target.organisationId
}

function toRoleList(roles: RoleInput): readonly string[] {
  return typeof roles === 'string' ? [roles] : roles
}

export function isActiveUser(user: OrgScopedUser): boolean {
  return user.isActive && !user.deletedAt
}

export function hasRole(user: Pick<SessionUser, 'role'>, roles: RoleInput): boolean {
  return toRoleList(roles).includes(user.role)
}

export function isSameOrg(user: Pick<SessionUser, 'organisationId'>, target: OrgTarget): boolean {
  return user.organisationId === toOrganisationId(target)
}

export function requireActiveUser(user: OrgScopedUser): void {
  if (!isActiveUser(user)) {
    throw new Error('forbidden: inactive user')
  }
}

export function requireSameOrg(user: OrgScopedUser, target: OrgTarget): void {
  requireActiveUser(user)

  if (!isSameOrg(user, target)) {
    throw new Error('forbidden: organisation mismatch')
  }
}

export function requireRole(
  user: Pick<SessionUser, 'role'>,
  roles: RoleInput,
  message = 'forbidden: admin role required',
): void {
  if (!hasRole(user, roles)) {
    throw new Error(message)
  }
}

export function requireOrgAdmin(user: GuardUser, target: OrgTarget): void {
  requireSameOrg(user, target)
  requireRole(user, ADMIN_ROLES)
}

export function requireOrgWriteAccess(user: GuardUser, target: OrgTarget): void {
  requireSameOrg(user, target)
  requireRole(user, MEMBERSHIP_ROLES, 'forbidden: write role required')
}
