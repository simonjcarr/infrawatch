import type { AssignedRole, LegacyRole } from './roles.ts'

const INVITE_ACCEPT_PATH = '/accept-invite'
const DIRECT_SIGNUP_ROLE: LegacyRole = 'pending'
const FIRST_USER_ROLE: AssignedRole = 'super_admin'

export type DirectSignupProvisioning = {
  instanceId?: string
  role: LegacyRole
  roles: AssignedRole[]
}

export function isInviteSignupCallback(callbackURL: unknown): boolean {
  if (typeof callbackURL !== 'string' || !callbackURL.trim()) return false

  try {
    const url = new URL(callbackURL, 'https://ct-ops.local')
    return url.pathname === INVITE_ACCEPT_PATH && Boolean(url.searchParams.get('token')?.trim())
  } catch {
    return false
  }
}

export function getDirectSignupProvisioning(input: {
  defaultInstanceId: string | null
  activeUserCount: number
}): DirectSignupProvisioning {
  const role = input.activeUserCount === 0 ? FIRST_USER_ROLE : DIRECT_SIGNUP_ROLE
  const provisioning: DirectSignupProvisioning = {
    role,
    roles: role === 'pending' ? [] : [role],
  }

  if (input.defaultInstanceId) {
    provisioning.instanceId = input.defaultInstanceId
  }

  return provisioning
}
