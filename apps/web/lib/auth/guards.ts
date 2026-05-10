import { ADMIN_ROLES, MEMBERSHIP_ROLES, normalizeAssignedRoles } from './roles.ts'
import type { SessionUser } from './session.ts'

type InstanceScopedUser = Pick<SessionUser, 'instanceId' | 'isActive' | 'deletedAt'>
type GuardUser = InstanceScopedUser & Pick<SessionUser, 'role'> & Partial<Pick<SessionUser, 'roles'>>
type InstanceTarget = string | { instanceId: string | null }
type RoleInput = string | readonly string[]

function toInstanceId(target: InstanceTarget): string | null {
  return typeof target === 'string' ? target : target.instanceId
}

function toRoleList(roles: RoleInput): readonly string[] {
  return typeof roles === 'string' ? [roles] : roles
}

export function isActiveUser(user: InstanceScopedUser): boolean {
  return user.isActive && !user.deletedAt
}

export function hasRole(user: Pick<SessionUser, 'role'> & Partial<Pick<SessionUser, 'roles'>>, roles: RoleInput): boolean {
  const userRoles = normalizeAssignedRoles(user.roles, user.role)
  return toRoleList(roles).some((role) => userRoles.some((userRole) => userRole === role))
}

export function isSameInstance(user: Pick<SessionUser, 'instanceId'>, target: InstanceTarget): boolean {
  return user.instanceId === toInstanceId(target)
}

export function requireActiveUser(user: InstanceScopedUser): void {
  if (!isActiveUser(user)) {
    throw new Error('forbidden: inactive user')
  }
}

export function requireSameInstance(user: InstanceScopedUser, target: InstanceTarget): void {
  requireActiveUser(user)

  if (!isSameInstance(user, target)) {
    throw new Error('forbidden: instance mismatch')
  }
}

export function requireRole(
  user: Pick<SessionUser, 'role'> & Partial<Pick<SessionUser, 'roles'>>,
  roles: RoleInput,
  message = 'forbidden: admin role required',
): void {
  if (!hasRole(user, roles)) {
    throw new Error(message)
  }
}

export function requireInstanceAdmin(user: GuardUser, target: InstanceTarget): void {
  requireSameInstance(user, target)
  requireRole(user, ADMIN_ROLES)
}

export function requireInstanceWriteAccess(user: GuardUser, target: InstanceTarget): void {
  requireSameInstance(user, target)
  requireRole(user, MEMBERSHIP_ROLES, 'forbidden: write role required')
}
