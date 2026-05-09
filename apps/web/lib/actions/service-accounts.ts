'use server'

import { getRequiredSession } from '@/lib/auth/session'
import {
  getServiceAccount as getServiceAccountCore,
  getServiceAccounts as getServiceAccountsCore,
  getServiceAccountCounts as getServiceAccountCountsCore,
  getSshKeysByFingerprint as getSshKeysByFingerprintCore,
  type ServiceAccountCounts,
  type ServiceAccountListFilters,
  type ServiceAccountWithHost,
} from './service-accounts-core'
import { resolveCurrentActionScope } from './action-scope'

export type {
  ServiceAccountCounts,
  ServiceAccountListFilters,
  ServiceAccountWithHost,
} from './service-accounts-core'

export async function getServiceAccounts(
  ...args: [ServiceAccountListFilters?] | [string, ServiceAccountListFilters?]
): Promise<ServiceAccountWithHost[]> {
  const session = await getRequiredSession()
  const currentScope =
    typeof args[0] === 'string' ? args[0] : resolveCurrentActionScope(session)
  const filters =
    typeof args[0] === 'string'
      ? args[1]
      : args[0]
  return getServiceAccountsCore(currentScope, filters)
}

export async function getServiceAccount(
  ...args: [string, string?] | [string, string, string?]
): Promise<Awaited<ReturnType<typeof getServiceAccountCore>>> {
  const session = await getRequiredSession()
  const currentScope =
    args.length >= 3 ? args[0] : resolveCurrentActionScope(session)
  const accountId = (args.length >= 3 ? args[1] : args[0]) as string
  const hostId = args.length >= 3 ? args[2] : args[1]
  return getServiceAccountCore(currentScope, accountId, hostId)
}

export async function getServiceAccountCounts(
  ...args: [] | [string]
): Promise<ServiceAccountCounts> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveCurrentActionScope(session)
  return getServiceAccountCountsCore(currentScope)
}

export async function getSshKeysByFingerprint(
  ...args: [string] | [string, string]
): Promise<Awaited<ReturnType<typeof getSshKeysByFingerprintCore>>> {
  const session = await getRequiredSession()
  const [currentScope, fingerprint] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return getSshKeysByFingerprintCore(currentScope, fingerprint)
}
