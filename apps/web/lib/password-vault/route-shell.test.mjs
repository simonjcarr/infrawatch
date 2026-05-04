import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PASSWORD_VAULT_ROUTE_TEST_IDS,
  buildPasswordVaultRouteShellState,
} from './route-shell.ts'

test('password vault route shell renders first-use state before setup', () => {
  assert.deepEqual(buildPasswordVaultRouteShellState({
    setupStatus: { configured: false, setupCompletedAt: null },
    unlocked: false,
    vaultCount: 0,
  }), {
    mode: 'first-use',
    testId: PASSWORD_VAULT_ROUTE_TEST_IDS.firstUseState,
    primaryAction: 'Set up unlock password',
  })
})

test('password vault route shell renders locked state after setup while locked', () => {
  assert.deepEqual(buildPasswordVaultRouteShellState({
    setupStatus: { configured: true, setupCompletedAt: '2026-05-04T19:46:00.000Z' },
    unlocked: false,
    vaultCount: 2,
  }), {
    mode: 'locked',
    testId: PASSWORD_VAULT_ROUTE_TEST_IDS.lockedState,
    primaryAction: 'Unlock vault',
  })
})

test('password vault route shell renders empty state after unlock with no vaults', () => {
  assert.deepEqual(buildPasswordVaultRouteShellState({
    setupStatus: { configured: true, setupCompletedAt: '2026-05-04T19:46:00.000Z' },
    unlocked: true,
    vaultCount: 0,
  }), {
    mode: 'empty',
    testId: PASSWORD_VAULT_ROUTE_TEST_IDS.emptyState,
    primaryAction: 'Create vault',
  })
})

test('password vault route shell renders ready state after unlock with vaults', () => {
  assert.deepEqual(buildPasswordVaultRouteShellState({
    setupStatus: { configured: true, setupCompletedAt: '2026-05-04T19:46:00.000Z' },
    unlocked: true,
    vaultCount: 3,
  }), {
    mode: 'ready',
    testId: PASSWORD_VAULT_ROUTE_TEST_IDS.readyState,
    primaryAction: 'Add entry',
  })
})
