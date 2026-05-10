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

export function resolveOptionalActionScope(
  session: Awaited<ReturnType<typeof getRequiredSession>>,
): string | null {
  return session.user.organisationId ?? null
}
