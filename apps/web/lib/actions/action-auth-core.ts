import { requireInstanceAdmin, requireInstanceWriteAccess as requireWriteAccess, requireSameInstance } from '../auth/guards.ts'

export type InstanceScopedUser = {
  instanceId: string | null
  isActive: boolean
  deletedAt: Date | null
}

export type InstanceAdminScopedUser = InstanceScopedUser & {
  role: string
}

export function assertInstanceAccess(user: InstanceScopedUser, instanceId: string): void {
  requireSameInstance(user, instanceId)
}

export function assertInstanceAdminAccess(user: InstanceAdminScopedUser, instanceId: string): void {
  requireInstanceAdmin(user, instanceId)
}

export function assertInstanceWriteAccess(user: InstanceAdminScopedUser, instanceId: string): void {
  requireWriteAccess(user, instanceId)
}
