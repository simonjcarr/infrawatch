export const PASSWORD_VAULT_MEMBER_ROLES = ['owner', 'admin', 'member'] as const
export type PasswordVaultMemberRole = (typeof PASSWORD_VAULT_MEMBER_ROLES)[number]

export const PASSWORD_VAULT_MAX_READ_BODY_BYTES = 0
export const PASSWORD_VAULT_MAX_MUTATION_BODY_BYTES = 64 * 1024

export type PasswordVaultRateLimitPolicy = {
  scope: string
  windowMs: number
  max: number
}

export type PasswordVaultRoutePolicy = {
  id: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  mutation: boolean
  requiresSession: true
  requiresOrganisation: true
  requiresTrustedOrigin: boolean
  maxBodyBytes: number
  vaultLookupScope?: 'organisation'
  requiresActiveMembership?: boolean
  allowedMemberRoles?: readonly PasswordVaultMemberRole[]
  rateLimit?: PasswordVaultRateLimitPolicy
}

export const PASSWORD_VAULT_API_RATE_LIMITS = {
  setup: {
    scope: 'password-vault:setup',
    windowMs: 10 * 60 * 1000,
    max: 5,
  },
  unlock: {
    scope: 'password-vault:unlock',
    windowMs: 5 * 60 * 1000,
    max: 20,
  },
  share: {
    scope: 'password-vault:share',
    windowMs: 10 * 60 * 1000,
    max: 30,
  },
  sensitiveAudit: {
    scope: 'password-vault:sensitive-audit',
    windowMs: 60 * 1000,
    max: 60,
  },
} as const satisfies Record<string, PasswordVaultRateLimitPolicy>

const MEMBER_ROLES = PASSWORD_VAULT_MEMBER_ROLES
const MANAGER_ROLES = ['owner', 'admin'] as const satisfies readonly PasswordVaultMemberRole[]

function readPolicy(id: string, path: string): PasswordVaultRoutePolicy {
  return {
    id,
    method: 'GET',
    path,
    mutation: false,
    requiresSession: true,
    requiresOrganisation: true,
    requiresTrustedOrigin: false,
    maxBodyBytes: PASSWORD_VAULT_MAX_READ_BODY_BYTES,
  }
}

function mutationPolicy(
  id: string,
  method: PasswordVaultRoutePolicy['method'],
  path: string,
  options: Pick<
    PasswordVaultRoutePolicy,
    'allowedMemberRoles' | 'rateLimit' | 'requiresActiveMembership' | 'vaultLookupScope'
  > = {},
): PasswordVaultRoutePolicy {
  return {
    id,
    method,
    path,
    mutation: true,
    requiresSession: true,
    requiresOrganisation: true,
    requiresTrustedOrigin: true,
    maxBodyBytes: PASSWORD_VAULT_MAX_MUTATION_BODY_BYTES,
    ...options,
  }
}

function vaultReadPolicy(
  id: string,
  path: string,
  allowedMemberRoles: readonly PasswordVaultMemberRole[] = MEMBER_ROLES,
): PasswordVaultRoutePolicy {
  return {
    ...readPolicy(id, path),
    vaultLookupScope: 'organisation',
    requiresActiveMembership: true,
    allowedMemberRoles,
  }
}

function vaultMutationPolicy(
  id: string,
  method: PasswordVaultRoutePolicy['method'],
  path: string,
  allowedMemberRoles: readonly PasswordVaultMemberRole[],
  rateLimit?: PasswordVaultRateLimitPolicy,
): PasswordVaultRoutePolicy {
  return mutationPolicy(id, method, path, {
    vaultLookupScope: 'organisation',
    requiresActiveMembership: true,
    allowedMemberRoles,
    rateLimit,
  })
}

export const PASSWORD_VAULT_API_POLICY = {
  setupStatus: readPolicy('setupStatus', '/api/password-vault/setup-status'),
  userKey: readPolicy('userKey', '/api/password-vault/user-key'),
  putUserKey: mutationPolicy('putUserKey', 'PUT', '/api/password-vault/user-key', {
    rateLimit: PASSWORD_VAULT_API_RATE_LIMITS.setup,
  }),
  unlockMetadata: {
    ...readPolicy('unlockMetadata', '/api/password-vault/unlock-metadata'),
    rateLimit: PASSWORD_VAULT_API_RATE_LIMITS.unlock,
  },
  unlockAudit: mutationPolicy('unlockAudit', 'POST', '/api/password-vault/unlock-audit', {
    rateLimit: PASSWORD_VAULT_API_RATE_LIMITS.sensitiveAudit,
  }),
  listVaults: readPolicy('listVaults', '/api/password-vault/vaults'),
  createVault: mutationPolicy('createVault', 'POST', '/api/password-vault/vaults'),
  getVault: vaultReadPolicy('getVault', '/api/password-vault/vaults/:vaultId'),
  updateVault: vaultMutationPolicy(
    'updateVault',
    'PATCH',
    '/api/password-vault/vaults/:vaultId',
    MANAGER_ROLES,
  ),
  deleteVault: vaultMutationPolicy(
    'deleteVault',
    'DELETE',
    '/api/password-vault/vaults/:vaultId',
    MANAGER_ROLES,
  ),
  listEntries: vaultReadPolicy(
    'listEntries',
    '/api/password-vault/vaults/:vaultId/entries',
  ),
  createEntry: vaultMutationPolicy(
    'createEntry',
    'POST',
    '/api/password-vault/vaults/:vaultId/entries',
    MEMBER_ROLES,
  ),
  getEntry: vaultReadPolicy(
    'getEntry',
    '/api/password-vault/vaults/:vaultId/entries/:entryId',
  ),
  updateEntry: vaultMutationPolicy(
    'updateEntry',
    'PATCH',
    '/api/password-vault/vaults/:vaultId/entries/:entryId',
    MEMBER_ROLES,
  ),
  deleteEntry: vaultMutationPolicy(
    'deleteEntry',
    'DELETE',
    '/api/password-vault/vaults/:vaultId/entries/:entryId',
    MEMBER_ROLES,
  ),
  listMembers: vaultReadPolicy(
    'listMembers',
    '/api/password-vault/vaults/:vaultId/members',
  ),
  addMember: vaultMutationPolicy(
    'addMember',
    'POST',
    '/api/password-vault/vaults/:vaultId/members',
    MANAGER_ROLES,
    PASSWORD_VAULT_API_RATE_LIMITS.share,
  ),
  updateMember: vaultMutationPolicy(
    'updateMember',
    'PATCH',
    '/api/password-vault/vaults/:vaultId/members/:userId',
    MANAGER_ROLES,
    PASSWORD_VAULT_API_RATE_LIMITS.share,
  ),
  removeMember: vaultMutationPolicy(
    'removeMember',
    'DELETE',
    '/api/password-vault/vaults/:vaultId/members/:userId',
    MANAGER_ROLES,
    PASSWORD_VAULT_API_RATE_LIMITS.share,
  ),
  rotateKeyEpoch: vaultMutationPolicy(
    'rotateKeyEpoch',
    'POST',
    '/api/password-vault/vaults/:vaultId/key-epochs',
    MANAGER_ROLES,
  ),
  exportAudit: vaultMutationPolicy(
    'exportAudit',
    'POST',
    '/api/password-vault/vaults/:vaultId/export-audit',
    MEMBER_ROLES,
    PASSWORD_VAULT_API_RATE_LIMITS.sensitiveAudit,
  ),
  revealAudit: vaultMutationPolicy(
    'revealAudit',
    'POST',
    '/api/password-vault/vaults/:vaultId/entries/:entryId/reveal-audit',
    MEMBER_ROLES,
    PASSWORD_VAULT_API_RATE_LIMITS.sensitiveAudit,
  ),
  copyAudit: vaultMutationPolicy(
    'copyAudit',
    'POST',
    '/api/password-vault/vaults/:vaultId/entries/:entryId/copy-audit',
    MEMBER_ROLES,
    PASSWORD_VAULT_API_RATE_LIMITS.sensitiveAudit,
  ),
} as const satisfies Record<string, PasswordVaultRoutePolicy>

export function findPasswordVaultRoutePolicy(
  method: string,
  path: string,
): PasswordVaultRoutePolicy | undefined {
  const normalisedMethod = method.toUpperCase()

  return Object.values(PASSWORD_VAULT_API_POLICY).find(
    (policy) => policy.method === normalisedMethod && policy.path === path,
  )
}

export function assertPasswordVaultMutationBodySize(bodyBytes: number): void {
  if (bodyBytes > PASSWORD_VAULT_MAX_MUTATION_BODY_BYTES) {
    throw new Error('Password Vault payload too large')
  }
}

export function assertPasswordVaultReadBodySize(bodyBytes: number): void {
  if (bodyBytes > PASSWORD_VAULT_MAX_READ_BODY_BYTES) {
    throw new Error('Password Vault request body is not allowed for read routes')
  }
}
