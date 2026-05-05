import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createInitialPasswordManagerWorkspaceState,
  filterPasswordManagerEntries,
  filterPasswordManagerVaults,
  reducePasswordManagerWorkspaceState,
} from './workspace.ts'

test('vault filtering stays local and sorts newest first', () => {
  const vaults = [
    {
      id: 'vault-1',
      metadata: { name: 'Shared production', description: 'postgres and nginx' },
      currentKeyEpoch: 2,
      role: 'owner',
      updatedAt: '2026-05-05T10:00:00Z',
      wrappedVaultKeyEnvelope: { wrapped_key_b64: 'one' },
    },
    {
      id: 'vault-2',
      metadata: { name: 'Staging apps', description: 'preview environments' },
      currentKeyEpoch: 1,
      role: 'viewer',
      updatedAt: '2026-05-05T12:00:00Z',
      wrappedVaultKeyEnvelope: { wrapped_key_b64: 'two' },
    },
  ]

  const filtered = filterPasswordManagerVaults(vaults, 'preview')

  assert.deepEqual(filtered.map((vault) => vault.id), ['vault-2'])
})

test('entry filtering stays local and matches decrypted fields only in memory', () => {
  const entries = [
    {
      id: 'entry-1',
      vaultId: 'vault-1',
      payload: { title: 'Postgres root', username: 'postgres', password: 'secret', notes: 'cluster a' },
      keyEpoch: 2,
      updatedAt: '2026-05-05T11:00:00Z',
    },
    {
      id: 'entry-2',
      vaultId: 'vault-1',
      payload: { title: 'Grafana admin', username: 'admin', password: 'secret', url: 'https://grafana.test' },
      keyEpoch: 2,
      updatedAt: '2026-05-05T12:00:00Z',
    },
  ]

  const filtered = filterPasswordManagerEntries(entries, 'grafana')

  assert.deepEqual(filtered.map((entry) => entry.id), ['entry-2'])
})

test('workspace reducer clears selection on unavailable objects', () => {
  const loaded = reducePasswordManagerWorkspaceState(createInitialPasswordManagerWorkspaceState(), {
    type: 'workspace-loaded',
    hasVaults: true,
    preferredVaultId: 'vault-1',
  })
  const selectedEntry = reducePasswordManagerWorkspaceState(loaded, {
    type: 'entry-selected',
    entryId: 'entry-2',
  })
  const unavailable = reducePasswordManagerWorkspaceState(selectedEntry, { type: 'object-unavailable' })

  assert.deepEqual(unavailable, {
    selectedEntryId: null,
    selectedVaultId: null,
    view: 'object-unavailable',
  })
})
