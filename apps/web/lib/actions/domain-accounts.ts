'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  createDomainAccount as createDomainAccountCore,
  deleteDomainAccount as deleteDomainAccountCore,
  getDomainAccount as getDomainAccountCore,
  getDomainAccountCounts as getDomainAccountCountsCore,
  getDomainAccounts as getDomainAccountsCore,
  updateDomainAccount as updateDomainAccountCore,
  type DomainAccountCounts,
  type DomainAccountListFilters,
} from './domain-accounts-core'

export type {
  DomainAccountCounts,
  DomainAccountListFilters,
} from './domain-accounts-core'

export async function getDomainAccounts(
  filters: DomainAccountListFilters = {},
): Promise<Awaited<ReturnType<typeof getDomainAccountsCore>>> {
  const session = await getRequiredSession()
  return getDomainAccountsCore(resolveCurrentActionScope(session), filters)
}

export async function getDomainAccount(
  accountId: string,
): Promise<Awaited<ReturnType<typeof getDomainAccountCore>>> {
  const session = await getRequiredSession()
  return getDomainAccountCore(resolveCurrentActionScope(session), accountId)
}

export async function getDomainAccountCounts(): Promise<DomainAccountCounts> {
  const session = await getRequiredSession()
  return getDomainAccountCountsCore(resolveCurrentActionScope(session))
}

export async function createDomainAccount(
  input: Parameters<typeof createDomainAccountCore>[1],
): Promise<Awaited<ReturnType<typeof createDomainAccountCore>>> {
  const session = await getRequiredSession()
  return createDomainAccountCore(resolveCurrentActionScope(session), input)
}

export async function updateDomainAccount(
  accountId: string,
  input: Parameters<typeof updateDomainAccountCore>[2],
): Promise<Awaited<ReturnType<typeof updateDomainAccountCore>>> {
  const session = await getRequiredSession()
  return updateDomainAccountCore(resolveCurrentActionScope(session), accountId, input)
}

export async function deleteDomainAccount(
  accountId: string,
): Promise<Awaited<ReturnType<typeof deleteDomainAccountCore>>> {
  const session = await getRequiredSession()
  return deleteDomainAccountCore(resolveCurrentActionScope(session), accountId)
}
