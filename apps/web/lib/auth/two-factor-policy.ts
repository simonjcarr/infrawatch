import type { OrgMetadata } from '@/lib/db/schema/organisations'

export const TWO_FACTOR_SETUP_PATH = '/profile?setup=two-factor'

const TWO_FACTOR_SETUP_ALLOWED_PATHS = new Set(['/profile'])

export function isTwoFactorRequired(metadata: Pick<OrgMetadata, 'securitySettings'>): boolean {
  return metadata.securitySettings?.requireTwoFactor === true
}

export function isTwoFactorSetupAllowedPath(pathname: string): boolean {
  return TWO_FACTOR_SETUP_ALLOWED_PATHS.has(pathname)
}

export function getTwoFactorPolicyRedirect({
  metadata,
  userTwoFactorEnabled,
  pathname,
}: {
  metadata: Pick<OrgMetadata, 'securitySettings'>
  userTwoFactorEnabled: boolean
  pathname: string
}): string | null {
  if (!isTwoFactorRequired(metadata)) return null
  if (userTwoFactorEnabled) return null
  if (isTwoFactorSetupAllowedPath(pathname)) return null
  return TWO_FACTOR_SETUP_PATH
}
