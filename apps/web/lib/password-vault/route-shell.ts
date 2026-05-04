import type { PasswordVaultSetupStatusResponse } from './profile-api.ts'

export const PASSWORD_VAULT_ROUTE_TEST_IDS = {
  page: 'password-vault-page',
  heading: 'password-vault-heading',
  firstUseState: 'password-vault-first-use-state',
  lockedState: 'password-vault-locked-state',
  emptyState: 'password-vault-empty-state',
  readyState: 'password-vault-ready-state',
  loadingState: 'password-vault-loading-state',
  errorState: 'password-vault-error-state',
  setupAction: 'password-vault-setup-action',
  unlockAction: 'password-vault-unlock-action',
  createVaultAction: 'password-vault-create-vault-action',
  addEntryAction: 'password-vault-add-entry-action',
} as const

export type PasswordVaultRouteShellMode = 'first-use' | 'locked' | 'empty' | 'ready'

export type PasswordVaultRouteShellState = {
  mode: PasswordVaultRouteShellMode
  testId: string
  primaryAction: string
}

export function buildPasswordVaultRouteShellState({
  setupStatus,
  unlocked,
  vaultCount,
}: {
  setupStatus: PasswordVaultSetupStatusResponse
  unlocked: boolean
  vaultCount: number
}): PasswordVaultRouteShellState {
  if (!setupStatus.configured) {
    return {
      mode: 'first-use',
      testId: PASSWORD_VAULT_ROUTE_TEST_IDS.firstUseState,
      primaryAction: 'Set up unlock password',
    }
  }

  if (!unlocked) {
    return {
      mode: 'locked',
      testId: PASSWORD_VAULT_ROUTE_TEST_IDS.lockedState,
      primaryAction: 'Unlock vault',
    }
  }

  if (vaultCount === 0) {
    return {
      mode: 'empty',
      testId: PASSWORD_VAULT_ROUTE_TEST_IDS.emptyState,
      primaryAction: 'Create vault',
    }
  }

  return {
    mode: 'ready',
    testId: PASSWORD_VAULT_ROUTE_TEST_IDS.readyState,
    primaryAction: 'Add entry',
  }
}
