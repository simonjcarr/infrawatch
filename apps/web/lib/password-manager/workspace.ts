import type {
  VaultRecord,
} from './client.ts'

export interface PasswordManagerVaultMetadata {
  name: string
  description?: string
}

export interface PasswordManagerEntryPayload {
  title: string
  type?: 'login' | 'card' | 'identity' | 'secure-note'
  username?: string
  password?: string
  notes?: string
  url?: string
  fields?: Record<string, string>
}

export interface PasswordManagerVaultSummary {
  id: string
  metadata: PasswordManagerVaultMetadata
  currentKeyEpoch: number
  role: string
  updatedAt: string
  wrappedVaultKeyEnvelope: VaultRecord['wrapped_vault_key_envelope']
}

export interface PasswordManagerEntrySummary {
  id: string
  vaultId: string
  payload: PasswordManagerEntryPayload
  keyEpoch: number
  updatedAt: string
}

export interface PasswordManagerWorkspaceState {
  selectedEntryId: string | null
  selectedVaultId: string | null
  view: 'idle' | 'loading' | 'ready' | 'object-unavailable'
}

export type PasswordManagerWorkspaceEvent =
  | { type: 'vault-selected'; vaultId: string }
  | { type: 'entry-selected'; entryId: string | null }
  | { type: 'workspace-loaded'; hasVaults: boolean; preferredVaultId?: string | null }
  | { type: 'vault-removed'; vaultId: string }
  | { type: 'entry-removed'; entryId: string }
  | { type: 'object-unavailable' }
  | { type: 'restart' }

export function createInitialPasswordManagerWorkspaceState(): PasswordManagerWorkspaceState {
  return {
    selectedEntryId: null,
    selectedVaultId: null,
    view: 'idle',
  }
}

export function filterPasswordManagerVaults(
  vaults: PasswordManagerVaultSummary[],
  query: string,
): PasswordManagerVaultSummary[] {
  const normalizedQuery = normalizeSearchQuery(query)
  const filtered = normalizedQuery
    ? vaults.filter((vault) =>
        `${vault.metadata.name} ${vault.metadata.description ?? ''} ${vault.role}`.toLowerCase().includes(normalizedQuery),
      )
    : vaults

  return [...filtered].sort((left, right) => {
    const updatedCompare = right.updatedAt.localeCompare(left.updatedAt)
    if (updatedCompare !== 0) {
      return updatedCompare
    }
    return left.metadata.name.localeCompare(right.metadata.name)
  })
}

export function filterPasswordManagerEntries(
  entries: PasswordManagerEntrySummary[],
  query: string,
): PasswordManagerEntrySummary[] {
  const normalizedQuery = normalizeSearchQuery(query)
  const filtered = normalizedQuery
    ? entries.filter((entry) =>
        `${entry.payload.title} ${entry.payload.username ?? ''} ${entry.payload.url ?? ''} ${entry.payload.notes ?? ''} ${Object.values(entry.payload.fields ?? {}).join(' ')}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : entries

  return [...filtered].sort((left, right) => {
    const updatedCompare = right.updatedAt.localeCompare(left.updatedAt)
    if (updatedCompare !== 0) {
      return updatedCompare
    }
    return left.payload.title.localeCompare(right.payload.title)
  })
}

export function reducePasswordManagerWorkspaceState(
  state: PasswordManagerWorkspaceState,
  event: PasswordManagerWorkspaceEvent,
): PasswordManagerWorkspaceState {
  switch (event.type) {
    case 'vault-selected':
      return {
        selectedEntryId: null,
        selectedVaultId: event.vaultId,
        view: 'ready',
      }
    case 'entry-selected':
      return {
        ...state,
        selectedEntryId: event.entryId,
      }
    case 'workspace-loaded': {
      const selectedVaultId = event.preferredVaultId ?? (event.hasVaults ? state.selectedVaultId : null)
      return {
        selectedEntryId: selectedVaultId === state.selectedVaultId ? state.selectedEntryId : null,
        selectedVaultId,
        view: event.hasVaults ? 'ready' : 'idle',
      }
    }
    case 'vault-removed':
      if (state.selectedVaultId !== event.vaultId) {
        return state
      }
      return {
        selectedEntryId: null,
        selectedVaultId: null,
        view: 'idle',
      }
    case 'entry-removed':
      if (state.selectedEntryId !== event.entryId) {
        return state
      }
      return {
        ...state,
        selectedEntryId: null,
      }
    case 'object-unavailable':
      return {
        selectedEntryId: null,
        selectedVaultId: null,
        view: 'object-unavailable',
      }
    case 'restart':
      return createInitialPasswordManagerWorkspaceState()
  }
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase()
}
