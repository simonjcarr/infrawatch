const LDAP_TENANT_SLUG_PATTERN = /^[a-z0-9-]{2,50}$/

export function normalizeLdapTenantSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const slug = value.trim().toLowerCase()
  if (!LDAP_TENANT_SLUG_PATTERN.test(slug)) return null
  return slug
}

export interface TenantScopedLdapConfig {
  organisationSlug: string
  enabled: boolean
  allowLogin: boolean
  deletedAt: Date | null
}

export function filterLdapConfigsForTenant<T extends TenantScopedLdapConfig>(
  configs: readonly T[],
  tenantSlug: unknown,
): T[] {
  const slug = normalizeLdapTenantSlug(tenantSlug)
  if (!slug) return []

  return configs.filter((config) => (
    config.organisationSlug === slug
    && config.enabled
    && config.allowLogin
    && config.deletedAt === null
  ))
}
