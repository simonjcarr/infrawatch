import { getRequiredSession } from '@/lib/auth/session'

export function resolveCurrentActionScope(
  session: Awaited<ReturnType<typeof getRequiredSession>>,
): string {
  const currentScope = session.user.organisationId
  if (!currentScope) {
    throw new Error('Instance scope is not configured')
  }
  return currentScope
}
