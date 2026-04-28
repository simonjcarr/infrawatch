import { getRequiredSession, type RequiredSession } from '@/lib/auth/session'
import { assertOrgAccess, assertOrgAdminAccess } from '@/lib/actions/action-auth-core'

export async function requireOrgAccess(orgId: string): Promise<RequiredSession> {
  const session = await getRequiredSession()
  assertOrgAccess(session.user, orgId)
  return session
}

export async function requireOrgAdminAccess(orgId: string): Promise<RequiredSession> {
  const session = await getRequiredSession()
  assertOrgAdminAccess(session.user, orgId)
  return session
}
