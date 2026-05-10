import { getRequiredSession, type RequiredSession } from '@/lib/auth/session'
import { assertInstanceAccess, assertInstanceAdminAccess, assertInstanceWriteAccess } from '@/lib/actions/action-auth-core'
import { requireToolingAccess } from '@/lib/auth/tooling'

export async function requireInstanceAccess(instanceId: string): Promise<RequiredSession> {
  const session = await getRequiredSession()
  assertInstanceAccess(session.user, instanceId)
  return session
}

export async function requireInstanceAdminAccess(instanceId: string): Promise<RequiredSession> {
  const session = await getRequiredSession()
  assertInstanceAdminAccess(session.user, instanceId)
  return session
}

export async function requireInstanceWriteAccess(instanceId: string): Promise<RequiredSession> {
  const session = await getRequiredSession()
  assertInstanceWriteAccess(session.user, instanceId)
  return session
}

export async function requireInstanceToolingAccess(instanceId: string): Promise<RequiredSession> {
  const session = await requireInstanceWriteAccess(instanceId)
  requireToolingAccess(session.user)
  return session
}
