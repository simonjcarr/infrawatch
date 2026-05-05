'use client'

import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  AlertCircle,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  ShieldAlert,
  Trash2,
  Vault,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { logWarn } from '@/lib/logging'
import {
  createEncryptedEntryPayload,
  createEncryptedVaultMetadata,
  createUnlockProfile,
  decryptEntryPayload,
  decryptVaultMetadata,
  decryptUserPrivateKeyEnvelope,
  generateVaultKey,
  type PasswordManagerEncryptedPrivateKeyEnvelope,
  type PasswordManagerEncryptedPayloadEnvelope,
  type PasswordManagerKdfMetadata,
  type PasswordManagerWrappedVaultKeyEnvelope,
  unwrapVaultKeyEnvelope,
  wrapVaultKeyForMember,
} from '@/lib/password-manager/browser-crypto'
import {
  PasswordManagerApiError,
  type EntryRecord,
  type VaultRecord,
  createPasswordManagerClient,
} from '@/lib/password-manager/client'
import {
  createInitialPasswordManagerShellState,
  mapPasswordManagerErrorToShellView,
  reducePasswordManagerShellState,
  type PasswordManagerShellState,
} from '@/lib/password-manager/shell'
import {
  createInitialPasswordManagerWorkspaceState,
  filterPasswordManagerEntries,
  filterPasswordManagerVaults,
  reducePasswordManagerWorkspaceState,
  type PasswordManagerEntryPayload,
  type PasswordManagerEntrySummary,
  type PasswordManagerVaultMetadata,
  type PasswordManagerVaultSummary,
  type PasswordManagerWorkspaceState,
} from '@/lib/password-manager/workspace'

const PASSWORD_MANAGER_API_BASE_URL =
  process.env.NEXT_PUBLIC_PASSWORD_MANAGER_API_BASE_URL?.trim() || '/password-manager-api/'
const PASSWORD_MANAGER_LAUNCH_PATH = '/api/password-manager/launch-assertion'
const GENERIC_UNLOCK_FAILURE =
  'Password Manager could not unlock with the provided materials. Retry or relaunch.'
const GENERIC_SETUP_FAILURE = 'Password Manager setup could not be completed safely. Retry or relaunch.'

function toClientPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isObjectUnavailableError(error: unknown): boolean {
  return error instanceof PasswordManagerApiError && error.status === 404
}

function isSessionScopedError(error: unknown): boolean {
  return error instanceof PasswordManagerApiError && (error.status === 401 || error.status === 403)
}

export function PasswordManagerClientShell({ orgId }: { orgId: string }) {
  const client = useMemo(
    () =>
      createPasswordManagerClient({
        apiBaseUrl: PASSWORD_MANAGER_API_BASE_URL,
        launchPath: PASSWORD_MANAGER_LAUNCH_PATH,
      }),
    [],
  )
  const [state, dispatch] = useReducer(
    reducePasswordManagerShellState,
    orgId,
    createInitialPasswordManagerShellState,
  )
  const [workspaceState, workspaceDispatch] = useReducer(
    reducePasswordManagerWorkspaceState,
    undefined,
    createInitialPasswordManagerWorkspaceState,
  )
  const [setupPassword, setSetupPassword] = useState('')
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState('')
  const [unlockPassword, setUnlockPassword] = useState('')
  const [setupPending, setSetupPending] = useState(false)
  const [unlockPending, setUnlockPending] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)
  const [vaultsPending, setVaultsPending] = useState(false)
  const [entriesPending, setEntriesPending] = useState(false)
  const [workspacePending, setWorkspacePending] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [vaultFilter, setVaultFilter] = useState('')
  const [entryFilter, setEntryFilter] = useState('')
  const deferredVaultFilter = useDeferredValue(vaultFilter)
  const deferredEntryFilter = useDeferredValue(entryFilter)
  const [vaults, setVaults] = useState<PasswordManagerVaultSummary[]>([])
  const [entries, setEntries] = useState<PasswordManagerEntrySummary[]>([])
  const [createVaultName, setCreateVaultName] = useState('')
  const [createVaultDescription, setCreateVaultDescription] = useState('')
  const [renameVaultName, setRenameVaultName] = useState('')
  const [renameVaultDescription, setRenameVaultDescription] = useState('')
  const [entryTitle, setEntryTitle] = useState('')
  const [entryUsername, setEntryUsername] = useState('')
  const [entryPassword, setEntryPassword] = useState('')
  const [entryUrl, setEntryUrl] = useState('')
  const [entryNotes, setEntryNotes] = useState('')
  const [entryRevealId, setEntryRevealId] = useState<string | null>(null)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const vaultKeyCacheRef = useRef(new Map<string, CryptoKey>())
  const pendingVaultCreateRef = useRef<{
    encryptedMetadata: PasswordManagerEncryptedPayloadEnvelope
    metadata: PasswordManagerVaultMetadata
    wrappedVaultKeyEnvelope: PasswordManagerWrappedVaultKeyEnvelope
    idempotencyKey: string
    vaultKey: CryptoKey
  } | null>(null)

  const filteredVaults = filterPasswordManagerVaults(vaults, deferredVaultFilter)
  const selectedVault = vaults.find((vault) => vault.id === workspaceState.selectedVaultId) ?? null
  const filteredEntries = filterPasswordManagerEntries(entries, deferredEntryFilter)
  const selectedEntry = entries.find((entry) => entry.id === workspaceState.selectedEntryId) ?? null

  const handleWorkspaceEffectError = useEffectEvent((error: unknown, fallbackMessage: string) => {
    if (isSessionScopedError(error)) {
      dispatch({
        type: 'launch-failed',
        view: mapPasswordManagerErrorToShellView(error),
      })
      return
    }
    if (isObjectUnavailableError(error)) {
      workspaceDispatch({ type: 'object-unavailable' })
      setWorkspaceError('The requested vault or entry is no longer available. Refresh the workspace state and try again.')
      return
    }

    logWarn('[password-manager] workspace operation failed', error, {
      organisationId: state.organisationId,
      selectedVaultId: workspaceState.selectedVaultId,
      selectedEntryId: workspaceState.selectedEntryId,
    })
    setWorkspaceError(fallbackMessage)
  })

  function handleWorkspaceActionError(error: unknown, fallbackMessage: string) {
    if (isSessionScopedError(error)) {
      dispatch({
        type: 'launch-failed',
        view: mapPasswordManagerErrorToShellView(error),
      })
      return
    }
    if (isObjectUnavailableError(error)) {
      workspaceDispatch({ type: 'object-unavailable' })
      setWorkspaceError('The requested vault or entry is no longer available. Refresh the workspace state and try again.')
      return
    }

    logWarn('[password-manager] workspace operation failed', error, {
      organisationId: state.organisationId,
      selectedVaultId: workspaceState.selectedVaultId,
      selectedEntryId: workspaceState.selectedEntryId,
    })
    setWorkspaceError(fallbackMessage)
  }

  useEffect(() => {
    if (state.view !== 'launching') {
      return
    }

    let cancelled = false

    async function launch() {
      try {
        await client.launch()
        const setupStatus = await client.getSetupStatus()
        if (cancelled) {
          return
        }

        dispatch({
          type: 'launch-succeeded',
          setupConfigured: setupStatus.configured,
        })
      } catch (error) {
        if (cancelled) {
          return
        }

        const view = mapPasswordManagerErrorToShellView(error)
        logWarn('[password-manager] route shell launch failed', error, {
          organisationId: state.organisationId,
          shellView: view,
        })
        dispatch({ type: 'launch-failed', view })
      }
    }

    void launch()

    return () => {
      cancelled = true
    }
  }, [client, state.launchNonce, state.organisationId, state.view])

  useEffect(() => {
    if (state.view !== 'locked' || !state.setupConfigured || state.unlockMetadata) {
      return
    }

    let cancelled = false

    async function loadUnlockMetadata() {
      try {
        const response = await client.getUnlockMetadata()
        if (cancelled) {
          return
        }

        dispatch({
          type: 'unlock-metadata-loaded',
          kdfMetadata: response.kdf_metadata as unknown as PasswordManagerKdfMetadata,
        })
      } catch (error) {
        if (cancelled) {
          return
        }

        if (error instanceof PasswordManagerApiError) {
          dispatch({
            type: 'launch-failed',
            view: mapPasswordManagerErrorToShellView(error),
          })
          return
        }

        dispatch({ type: 'launch-failed', view: 'operational-failure' })
      }
    }

    void loadUnlockMetadata()

    return () => {
      cancelled = true
    }
  }, [client, state.setupConfigured, state.unlockMetadata, state.view])

  useEffect(() => {
    if (state.view === 'unlocked') {
      return
    }

    vaultKeyCacheRef.current = new Map()
    pendingVaultCreateRef.current = null
    setVaults([])
    setEntries([])
    setVaultFilter('')
    setEntryFilter('')
    setCreateVaultName('')
    setCreateVaultDescription('')
    setRenameVaultName('')
    setRenameVaultDescription('')
    setEntryTitle('')
    setEntryUsername('')
    setEntryPassword('')
    setEntryUrl('')
    setEntryNotes('')
    setEntryRevealId(null)
    setEditingEntryId(null)
    setWorkspaceError(null)
    workspaceDispatch({ type: 'restart' })
  }, [state.view])

  useEffect(() => {
    if (state.view !== 'unlocked' || !state.activeKeyPair) {
      return
    }

    let cancelled = false

    async function loadVaults() {
      setVaultsPending(true)
      setWorkspaceError(null)
      try {
        const response = await client.listVaults()
        const decryptedVaults = await Promise.all(
          response.vaults.map(async (record) => {
            const vaultKey = await unwrapVaultKeyEnvelope(
              record.wrapped_vault_key_envelope as unknown as PasswordManagerWrappedVaultKeyEnvelope,
              state.activeKeyPair!.privateKey as CryptoKey,
            )
            const metadata = await decryptVaultMetadata(
              record.encrypted_metadata as unknown as PasswordManagerEncryptedPayloadEnvelope,
              vaultKey,
            )
            vaultKeyCacheRef.current.set(record.id, vaultKey)
            return createVaultSummary(record, metadata)
          }),
        )
        if (cancelled) {
          return
        }

        setVaults(decryptedVaults)
        const preferredVaultId =
          decryptedVaults.find((vault) => vault.id === workspaceState.selectedVaultId)?.id ?? decryptedVaults[0]?.id ?? null
        workspaceDispatch({
          type: 'workspace-loaded',
          hasVaults: decryptedVaults.length > 0,
          preferredVaultId,
        })
      } catch (error) {
        if (cancelled) {
          return
        }
        handleWorkspaceEffectError(error, 'Password Manager vaults could not be loaded safely.')
      } finally {
        if (!cancelled) {
          setVaultsPending(false)
        }
      }
    }

    void loadVaults()

    return () => {
      cancelled = true
    }
  }, [client, state.activeKeyPair, state.launchNonce, state.view, workspaceState.selectedVaultId])

  useEffect(() => {
    if (state.view !== 'unlocked' || !workspaceState.selectedVaultId) {
      setEntries([])
      return
    }

    let cancelled = false

    async function loadEntries() {
      const vaultKey = vaultKeyCacheRef.current.get(workspaceState.selectedVaultId ?? '')
      if (!vaultKey) {
        setWorkspaceError('The selected vault key is no longer available in browser memory. Relock or relaunch.')
        return
      }

      setEntriesPending(true)
      setWorkspaceError(null)
      try {
        const response = await client.listEntries(workspaceState.selectedVaultId!)
        const decryptedEntries = await Promise.all(
          response.entries.map(async (record) =>
            createEntrySummary(
              record,
              await decryptEntryPayload<PasswordManagerEntryPayload>(
                record.encrypted_payload as unknown as PasswordManagerEncryptedPayloadEnvelope,
                vaultKey,
              ),
            ),
          ),
        )
        if (cancelled) {
          return
        }

        setEntries(decryptedEntries)
        if (!decryptedEntries.find((entry) => entry.id === workspaceState.selectedEntryId)) {
          workspaceDispatch({ type: 'entry-selected', entryId: decryptedEntries[0]?.id ?? null })
        }
      } catch (error) {
        if (cancelled) {
          return
        }
        handleWorkspaceEffectError(error, 'Password Manager entries could not be loaded safely.')
      } finally {
        if (!cancelled) {
          setEntriesPending(false)
        }
      }
    }

    void loadEntries()

    return () => {
      cancelled = true
    }
  }, [client, state.view, workspaceState.selectedEntryId, workspaceState.selectedVaultId])

  useEffect(() => {
    if (!selectedVault) {
      setRenameVaultName('')
      setRenameVaultDescription('')
      return
    }

    setRenameVaultName(selectedVault.metadata.name)
    setRenameVaultDescription(selectedVault.metadata.description ?? '')
  }, [selectedVault])

  useEffect(() => {
    if (!selectedEntry) {
      setEditingEntryId(null)
      setEntryTitle('')
      setEntryUsername('')
      setEntryPassword('')
      setEntryUrl('')
      setEntryNotes('')
      return
    }

    setEntryTitle(selectedEntry.payload.title)
    setEntryUsername(selectedEntry.payload.username)
    setEntryPassword(selectedEntry.payload.password)
    setEntryUrl(selectedEntry.payload.url ?? '')
    setEntryNotes(selectedEntry.payload.notes ?? '')
  }, [selectedEntry])

  async function handleSetupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (setupPending) {
      return
    }

    setStatusNotice(null)

    if (!setupPassword || !setupPasswordConfirm) {
      dispatch({ type: 'setup-failed', message: 'Choose and confirm an unlock password to continue.' })
      return
    }
    if (setupPassword !== setupPasswordConfirm) {
      dispatch({ type: 'setup-failed', message: 'The unlock passwords do not match.' })
      return
    }

    setSetupPending(true)
    try {
      const profile = await createUnlockProfile(setupPassword)
      await client.putUserKey({
        encryptedPrivateKeyEnvelope: toClientPayload(profile.encryptedPrivateKeyEnvelope) as never,
        kdfMetadata: toClientPayload(profile.kdfMetadata) as never,
      })
      const keyPair = await decryptUserPrivateKeyEnvelope({
        unlockPassword: setupPassword,
        encryptedPrivateKeyEnvelope: profile.encryptedPrivateKeyEnvelope,
        kdfMetadata: profile.kdfMetadata,
      })

      dispatch({
        type: 'setup-succeeded',
        encryptedPrivateKeyEnvelope: profile.encryptedPrivateKeyEnvelope,
        kdfMetadata: profile.kdfMetadata,
        keyPair,
      })
      setSetupPassword('')
      setSetupPasswordConfirm('')
      setUnlockPassword('')
      setStatusNotice('Unlock profile created and loaded locally for this browser session.')
    } catch (error) {
      if (error instanceof PasswordManagerApiError) {
        if (error.status === 409) {
          dispatch({ type: 'launch-succeeded', setupConfigured: true })
          setStatusNotice('An unlock profile already exists for this account. Enter your unlock password to continue.')
          return
        }
        if (error.status === 401 || error.status === 403 || error.status === 404) {
          dispatch({
            type: 'launch-failed',
            view: mapPasswordManagerErrorToShellView(error),
          })
          return
        }
      }

      logWarn('[password-manager] setup failed', error, {
        organisationId: state.organisationId,
      })
      dispatch({ type: 'setup-failed', message: GENERIC_SETUP_FAILURE })
    } finally {
      setSetupPending(false)
    }
  }

  async function handleUnlockSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (unlockPending) {
      return
    }

    setStatusNotice(null)

    if (!unlockPassword) {
      dispatch({ type: 'unlock-failed', message: 'Enter your unlock password to continue.', needsRelaunch: false })
      return
    }

    setUnlockPending(true)
    try {
      let encryptedEnvelope = state.encryptedPrivateKeyEnvelope
      let kdfMetadata = state.unlockMetadata

      if (!encryptedEnvelope) {
        const userKey = await client.getUserKey()
        encryptedEnvelope = userKey.encrypted_private_key_envelope as unknown as PasswordManagerEncryptedPrivateKeyEnvelope
        dispatch({
          type: 'unlock-material-loaded',
          encryptedPrivateKeyEnvelope: encryptedEnvelope,
        })
        if (!kdfMetadata) {
          kdfMetadata = userKey.kdf_metadata as unknown as PasswordManagerKdfMetadata
          dispatch({
            type: 'unlock-metadata-loaded',
            kdfMetadata,
          })
        }
      }

      if (!encryptedEnvelope || !kdfMetadata) {
        throw new Error('Password Manager unlock materials are incomplete')
      }

      const keyPair = await decryptUserPrivateKeyEnvelope({
        unlockPassword,
        encryptedPrivateKeyEnvelope: encryptedEnvelope,
        kdfMetadata,
      })

      dispatch({
        type: 'unlock-succeeded',
        encryptedPrivateKeyEnvelope: encryptedEnvelope,
        kdfMetadata,
        keyPair,
      })
      setUnlockPassword('')
      setStatusNotice('Password Manager unlocked in browser memory only.')
    } catch (error) {
      logWarn('[password-manager] unlock failed', error, {
        organisationId: state.organisationId,
      })
      dispatch({
        type: 'unlock-failed',
        message: GENERIC_UNLOCK_FAILURE,
        needsRelaunch: error instanceof PasswordManagerApiError && error.status === 401,
      })
    } finally {
      setUnlockPending(false)
    }
  }

  async function handleRefreshSession() {
    if (refreshPending) {
      return
    }

    setRefreshPending(true)
    setStatusNotice(null)
    try {
      await client.refreshSession()
      setStatusNotice('Password Manager session refreshed.')
    } catch (error) {
      logWarn('[password-manager] session refresh failed', error, {
        organisationId: state.organisationId,
      })
      if (error instanceof PasswordManagerApiError) {
        dispatch({
          type: 'launch-failed',
          view: mapPasswordManagerErrorToShellView(error),
        })
        return
      }
      dispatch({ type: 'launch-failed', view: 'operational-failure' })
    } finally {
      setRefreshPending(false)
    }
  }

  async function handleLogout() {
    if (logoutPending) {
      return
    }

    setLogoutPending(true)
    setStatusNotice(null)
    try {
      await client.logout()
    } catch (error) {
      logWarn('[password-manager] logout failed', error, {
        organisationId: state.organisationId,
      })
    } finally {
      dispatch({ type: 'restart-launch' })
      setSetupPassword('')
      setSetupPasswordConfirm('')
      setUnlockPassword('')
      setLogoutPending(false)
    }
  }

  function handleManualLock() {
    dispatch({ type: 'lock' })
    setUnlockPassword('')
    setStatusNotice('Decrypted Password Manager state cleared from browser memory.')
  }

  async function runVaultCreate(
    request = pendingVaultCreateRef.current,
  ) {
    if (!request) {
      if (!state.activeKeyPair) {
        setWorkspaceError('Unlock Password Manager before creating a vault.')
        return
      }
      const name = createVaultName.trim()
      if (!name) {
        setWorkspaceError('Enter a vault name to continue.')
        return
      }

      const metadata: PasswordManagerVaultMetadata = {
        name,
        description: createVaultDescription.trim() || undefined,
      }
      const vaultKey = await generateVaultKey()
      const encryptedMetadata = await createEncryptedVaultMetadata(metadata, vaultKey)
      const wrappedVaultKeyEnvelope = await wrapVaultKeyForMember(
        vaultKey,
        state.activeKeyPair.publicKey as CryptoKey,
      )
      request = {
        encryptedMetadata,
        metadata,
        wrappedVaultKeyEnvelope,
        idempotencyKey: createIdempotencyKey(),
        vaultKey,
      }
      pendingVaultCreateRef.current = request
    }

    setWorkspacePending(true)
    setWorkspaceError(null)
    try {
      const record = await client.createVault({
        encryptedMetadata: toClientPayload(request.encryptedMetadata) as never,
        wrappedVaultKeyEnvelope: toClientPayload(request.wrappedVaultKeyEnvelope) as never,
        idempotencyKey: request.idempotencyKey,
      })
      const summary = createVaultSummary(record, request.metadata)
      vaultKeyCacheRef.current.set(summary.id, request.vaultKey)
      setVaults((current) => filterPasswordManagerVaults([...current.filter((vault) => vault.id !== summary.id), summary], ''))
      workspaceDispatch({ type: 'vault-selected', vaultId: summary.id })
      pendingVaultCreateRef.current = null
      setCreateVaultName('')
      setCreateVaultDescription('')
      setStatusNotice('Vault created with encrypted metadata only.')
    } catch (error) {
      handleWorkspaceActionError(error, 'The vault could not be created safely. Retry with the same encrypted request.')
    } finally {
      setWorkspacePending(false)
    }
  }

  async function handleVaultRename() {
    if (!selectedVault) {
      return
    }
    const vaultKey = vaultKeyCacheRef.current.get(selectedVault.id)
    if (!vaultKey) {
      setWorkspaceError('The selected vault key is no longer available in browser memory. Relock or relaunch.')
      return
    }
    const name = renameVaultName.trim()
    if (!name) {
      setWorkspaceError('Enter a vault name to continue.')
      return
    }

    setWorkspacePending(true)
    setWorkspaceError(null)
    try {
      const metadata: PasswordManagerVaultMetadata = {
        name,
        description: renameVaultDescription.trim() || undefined,
      }
      const encryptedMetadata = await createEncryptedVaultMetadata(metadata, vaultKey)
      const updated = await client.updateVault({
        vaultId: selectedVault.id,
        encryptedMetadata: toClientPayload(encryptedMetadata) as never,
      })
      setVaults((current) =>
        current.map((vault) => (vault.id === updated.id ? createVaultSummary(updated, metadata) : vault)),
      )
      setStatusNotice('Vault metadata updated in encrypted form.')
    } catch (error) {
      handleWorkspaceActionError(error, 'The vault could not be renamed safely.')
    } finally {
      setWorkspacePending(false)
    }
  }

  async function handleVaultDelete() {
    if (!selectedVault) {
      return
    }

    setWorkspacePending(true)
    setWorkspaceError(null)
    try {
      await client.deleteVault(selectedVault.id)
      vaultKeyCacheRef.current.delete(selectedVault.id)
      setVaults((current) => current.filter((vault) => vault.id !== selectedVault.id))
      setEntries([])
      workspaceDispatch({ type: 'vault-removed', vaultId: selectedVault.id })
      setStatusNotice('Vault removed and decrypted browser state cleared for that vault.')
    } catch (error) {
      handleWorkspaceActionError(error, 'The vault could not be deleted safely.')
    } finally {
      setWorkspacePending(false)
    }
  }

  async function handleEntrySave() {
    if (!workspaceState.selectedVaultId || !selectedVault) {
      setWorkspaceError('Select a vault before saving an entry.')
      return
    }
    const vaultKey = vaultKeyCacheRef.current.get(workspaceState.selectedVaultId)
    if (!vaultKey) {
      setWorkspaceError('The selected vault key is no longer available in browser memory. Relock or relaunch.')
      return
    }

    const title = entryTitle.trim()
    const username = entryUsername.trim()
    const password = entryPassword.trim()
    if (!title || !username || !password) {
      setWorkspaceError('Entry title, username, and password are required.')
      return
    }

    const payload: PasswordManagerEntryPayload = {
      title,
      username,
      password,
      url: entryUrl.trim() || undefined,
      notes: entryNotes.trim() || undefined,
    }

    setWorkspacePending(true)
    setWorkspaceError(null)
    try {
      const encryptedPayload = await createEncryptedEntryPayload(payload, vaultKey)
      if (editingEntryId) {
        const updated = await client.updateEntry({
          vaultId: workspaceState.selectedVaultId,
          entryId: editingEntryId,
          encryptedPayload: toClientPayload(encryptedPayload) as never,
          keyEpoch: selectedVault.currentKeyEpoch,
        })
        const summary = createEntrySummary(updated, payload)
        setEntries((current) => current.map((entry) => (entry.id === summary.id ? summary : entry)))
        workspaceDispatch({ type: 'entry-selected', entryId: summary.id })
        setStatusNotice('Entry updated with encrypted payload only.')
      } else {
        const created = await client.createEntry({
          vaultId: workspaceState.selectedVaultId,
          encryptedPayload: toClientPayload(encryptedPayload) as never,
          keyEpoch: selectedVault.currentKeyEpoch,
        })
        const summary = createEntrySummary(created, payload)
        setEntries((current) => filterPasswordManagerEntries([...current, summary], ''))
        workspaceDispatch({ type: 'entry-selected', entryId: summary.id })
        setStatusNotice('Entry created with encrypted payload only.')
      }
      setEditingEntryId(null)
    } catch (error) {
      handleWorkspaceActionError(error, 'The entry could not be saved safely.')
    } finally {
      setWorkspacePending(false)
    }
  }

  async function handleEntryDelete() {
    if (!workspaceState.selectedVaultId || !selectedEntry) {
      return
    }

    setWorkspacePending(true)
    setWorkspaceError(null)
    try {
      await client.deleteEntry({
        vaultId: workspaceState.selectedVaultId,
        entryId: selectedEntry.id,
      })
      setEntries((current) => current.filter((entry) => entry.id !== selectedEntry.id))
      workspaceDispatch({ type: 'entry-removed', entryId: selectedEntry.id })
      setStatusNotice('Entry deleted and removed from browser memory.')
    } catch (error) {
      handleWorkspaceActionError(error, 'The entry could not be deleted safely.')
    } finally {
      setWorkspacePending(false)
    }
  }

  async function handleCopyPassword(entry: PasswordManagerEntrySummary) {
    try {
      await navigator.clipboard.writeText(entry.payload.password)
      setStatusNotice(`Password copied for ${entry.payload.title}.`)
    } catch (error) {
      handleWorkspaceActionError(error, 'The password could not be copied safely in this browser.')
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6" data-testid="password-manager-shell">
      <header className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-linear-to-br from-background via-background to-muted/40 p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline">Tooling</Badge>
            <Badge variant="secondary">Hosted at /password-manager</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleRefreshSession} disabled={refreshPending}>
              <RefreshCcw className="mr-2 size-4" />
              {refreshPending ? 'Refreshing…' : 'Refresh session'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout} disabled={logoutPending}>
              <LogOut className="mr-2 size-4" />
              {logoutPending ? 'Ending session…' : 'End session'}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Password Manager</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            CT-Ops launches the session only. Unlock passwords, decrypted key material, and plaintext secrets remain in
            browser-only code paths.
          </p>
        </div>
        {statusNotice ? (
          <Alert>
            <RefreshCcw className="size-4" />
            <AlertTitle>Session status</AlertTitle>
            <AlertDescription>{statusNotice}</AlertDescription>
          </Alert>
        ) : null}
      </header>

      <PasswordManagerShellCard
        state={state}
        setupPassword={setupPassword}
        setupPasswordConfirm={setupPasswordConfirm}
        setupPending={setupPending}
        unlockPassword={unlockPassword}
        unlockPending={unlockPending}
        onSetupPasswordChange={setSetupPassword}
        onSetupPasswordConfirmChange={setSetupPasswordConfirm}
        onUnlockPasswordChange={setUnlockPassword}
        onRetry={() => dispatch({ type: 'restart-launch' })}
        onLock={handleManualLock}
        onSetupSubmit={handleSetupSubmit}
        onUnlockSubmit={handleUnlockSubmit}
      />
      {state.view === 'unlocked' ? (
        <PasswordManagerWorkspace
          createVaultDescription={createVaultDescription}
          createVaultName={createVaultName}
          deferredEntryFilter={deferredEntryFilter}
          deferredVaultFilter={deferredVaultFilter}
          editingEntryId={editingEntryId}
          entries={filteredEntries}
          entriesPending={entriesPending}
          entryFilter={entryFilter}
          entryNotes={entryNotes}
          entryPassword={entryPassword}
          entryRevealId={entryRevealId}
          entryTitle={entryTitle}
          entryUrl={entryUrl}
          entryUsername={entryUsername}
          onCopyPassword={handleCopyPassword}
          onCreateVault={runVaultCreate}
          onCreateVaultDescriptionChange={setCreateVaultDescription}
          onCreateVaultNameChange={setCreateVaultName}
          onDeleteEntry={handleEntryDelete}
          onDeleteVault={handleVaultDelete}
          onEntryFilterChange={setEntryFilter}
          onEntryNotesChange={setEntryNotes}
          onEntryPasswordChange={setEntryPassword}
          onEntryRevealIdChange={setEntryRevealId}
          onEntrySave={handleEntrySave}
          onEntryTitleChange={setEntryTitle}
          onEntryUrlChange={setEntryUrl}
          onEntryUsernameChange={setEntryUsername}
          onRenameVault={handleVaultRename}
          onRenameVaultDescriptionChange={setRenameVaultDescription}
          onRenameVaultNameChange={setRenameVaultName}
          onRetryCreateVault={() => runVaultCreate(pendingVaultCreateRef.current)}
          onSelectEntry={(entryId) => workspaceDispatch({ type: 'entry-selected', entryId })}
          onSelectVault={(vaultId) => workspaceDispatch({ type: 'vault-selected', vaultId })}
          onStartCreateEntry={() => {
            setEditingEntryId(null)
            setEntryTitle('')
            setEntryUsername('')
            setEntryPassword('')
            setEntryUrl('')
            setEntryNotes('')
          }}
          onStartEditEntry={(entry) => {
            setEditingEntryId(entry.id)
            setEntryTitle(entry.payload.title)
            setEntryUsername(entry.payload.username)
            setEntryPassword(entry.payload.password)
            setEntryUrl(entry.payload.url ?? '')
            setEntryNotes(entry.payload.notes ?? '')
          }}
          onVaultFilterChange={setVaultFilter}
          renameVaultDescription={renameVaultDescription}
          renameVaultName={renameVaultName}
          selectedEntry={selectedEntry}
          selectedVault={selectedVault}
          vaultFilter={vaultFilter}
          vaults={filteredVaults}
          vaultsPending={vaultsPending}
          workspaceError={workspaceError}
          workspacePending={workspacePending}
          workspaceState={workspaceState}
        />
      ) : null}
    </section>
  )
}

function createVaultSummary(record: VaultRecord, metadata: PasswordManagerVaultMetadata): PasswordManagerVaultSummary {
  return {
    id: record.id,
    metadata,
    currentKeyEpoch: record.current_key_epoch,
    role: record.role,
    updatedAt: record.updated_at,
    wrappedVaultKeyEnvelope: record.wrapped_vault_key_envelope,
  }
}

function createEntrySummary(record: EntryRecord, payload: PasswordManagerEntryPayload): PasswordManagerEntrySummary {
  return {
    id: record.id,
    vaultId: record.vault_id,
    payload,
    keyEpoch: record.key_epoch,
    updatedAt: record.updated_at,
  }
}

function PasswordManagerShellCard({
  state,
  setupPassword,
  setupPasswordConfirm,
  setupPending,
  unlockPassword,
  unlockPending,
  onSetupPasswordChange,
  onSetupPasswordConfirmChange,
  onUnlockPasswordChange,
  onRetry,
  onLock,
  onSetupSubmit,
  onUnlockSubmit,
}: {
  state: PasswordManagerShellState
  setupPassword: string
  setupPasswordConfirm: string
  setupPending: boolean
  unlockPassword: string
  unlockPending: boolean
  onSetupPasswordChange: (value: string) => void
  onSetupPasswordConfirmChange: (value: string) => void
  onUnlockPasswordChange: (value: string) => void
  onRetry: () => void
  onLock: () => void
  onSetupSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onUnlockSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  switch (state.view) {
    case 'launching':
      return (
        <ShellCard
          icon={RefreshCcw}
          eyebrow="Launching"
          title="Starting your Password Manager session"
          description="CT-Ops is minting a fresh launch assertion and exchanging it for a Password Manager session."
          statusLabel="Launching"
          statusVariant="secondary"
          testId="password-manager-state-launching"
        />
      )
    case 'locked':
      return state.setupConfigured ? (
        <ShellCard
          icon={KeyRound}
          eyebrow="Locked"
          title="Unlock your Password Manager workspace"
          description="Your encrypted unlock profile is stored. Enter the unlock password locally in this browser to decrypt the session key pair."
          statusLabel={state.unlockMetadata ? 'Ready to unlock' : 'Preparing unlock'}
          statusVariant="outline"
          testId="password-manager-state-locked"
          footer={
            <div className="flex w-full flex-col gap-4">
              {state.unlockError ? (
                <Alert variant="destructive">
                  <ShieldAlert className="size-4" />
                  <AlertTitle>Unlock failed safely</AlertTitle>
                  <AlertDescription>{state.unlockError}</AlertDescription>
                </Alert>
              ) : null}
              <form className="grid gap-4" onSubmit={onUnlockSubmit}>
                <div className="grid gap-2">
                  <Label htmlFor="password-manager-unlock-password">Unlock password</Label>
                  <Input
                    id="password-manager-unlock-password"
                    type="password"
                    value={unlockPassword}
                    autoComplete="current-password"
                    onChange={(event) => onUnlockPasswordChange(event.target.value)}
                    disabled={unlockPending || !state.unlockMetadata}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={unlockPending || !state.unlockMetadata}>
                    {unlockPending ? 'Unlocking…' : 'Unlock'}
                  </Button>
                  {state.needsRelaunch ? (
                    <Button type="button" variant="outline" onClick={onRetry}>
                      Relaunch
                    </Button>
                  ) : null}
                </div>
              </form>
              <Alert>
                <Lock className="size-4" />
                <AlertTitle>Browser-only boundary preserved</AlertTitle>
                <AlertDescription>
                  CT-Ops brokers launch assertions only. Decrypted Password Manager keys are never persisted outside
                  this browser session.
                </AlertDescription>
              </Alert>
            </div>
          }
        />
      ) : (
        <ShellCard
          icon={KeyRound}
          eyebrow="First use"
          title="Create your unlock profile"
          description="Generate a browser-only keypair and protect the private key with a local unlock password before using Password Manager."
          statusLabel="Setup required"
          statusVariant="outline"
          testId="password-manager-state-setup-required"
          footer={
            <div className="flex w-full flex-col gap-4">
              {state.setupError ? (
                <Alert variant="destructive">
                  <ShieldAlert className="size-4" />
                  <AlertTitle>Setup blocked</AlertTitle>
                  <AlertDescription>{state.setupError}</AlertDescription>
                </Alert>
              ) : null}
              <form className="grid gap-4" onSubmit={onSetupSubmit}>
                <div className="grid gap-2">
                  <Label htmlFor="password-manager-setup-password">Unlock password</Label>
                  <Input
                    id="password-manager-setup-password"
                    type="password"
                    value={setupPassword}
                    autoComplete="new-password"
                    onChange={(event) => onSetupPasswordChange(event.target.value)}
                    disabled={setupPending}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password-manager-setup-password-confirm">Confirm unlock password</Label>
                  <Input
                    id="password-manager-setup-password-confirm"
                    type="password"
                    value={setupPasswordConfirm}
                    autoComplete="new-password"
                    onChange={(event) => onSetupPasswordConfirmChange(event.target.value)}
                    disabled={setupPending}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={setupPending}>
                    {setupPending ? 'Generating browser-only keys…' : 'Create unlock profile'}
                  </Button>
                </div>
              </form>
              <Alert>
                <Vault className="size-4" />
                <AlertTitle>Encrypted setup only</AlertTitle>
                <AlertDescription>
                  The setup call uploads only the encrypted private-key envelope and KDF metadata required for future
                  browser-side unlock.
                </AlertDescription>
              </Alert>
            </div>
          }
        />
      )
    case 'unlocked':
      return (
        <ShellCard
          icon={Vault}
          eyebrow="Unlocked"
          title="Password Manager workspace is active"
          description="The unlock keypair is loaded in browser memory. Vault and entry workflows attach to this shell next."
          statusLabel="Unlocked"
          statusVariant="secondary"
          testId="password-manager-state-unlocked"
          actions={
            <Button variant="outline" onClick={onLock}>
              <Lock className="mr-2 size-4" />
              Lock now
            </Button>
          }
          footer={
            <Alert>
              <KeyRound className="size-4" />
              <AlertTitle>Decrypted state is ephemeral</AlertTitle>
              <AlertDescription>
                Manual lock, logout, relaunch, and organisation changes purge the active Password Manager key material
                from browser memory.
              </AlertDescription>
            </Alert>
          }
        />
      )
    case 'session-expired':
      return (
        <ShellCard
          icon={AlertCircle}
          eyebrow="Session expired"
          title="Launch again to continue"
          description="The Password Manager session is no longer valid. Relaunch to fetch a fresh CT-Ops assertion and clear local shell state."
          statusLabel="Relaunch required"
          statusVariant="destructive"
          testId="password-manager-state-session-expired"
          actions={<Button onClick={onRetry}>Relaunch</Button>}
        />
      )
    case 'access-denied':
      return (
        <ShellCard
          icon={ShieldAlert}
          eyebrow="Access denied"
          title="Password Manager access is restricted"
          description="Your current CT-Ops session does not have access to launch the Password Manager for this organisation."
          statusLabel="Access denied"
          statusVariant="destructive"
          testId="password-manager-state-access-denied"
          actions={
            <Button variant="outline" onClick={onRetry}>
              Retry launch
            </Button>
          }
        />
      )
    case 'object-unavailable':
      return (
        <ShellCard
          icon={AlertCircle}
          eyebrow="Unavailable"
          title="The requested Password Manager state is unavailable"
          description="The Password Manager service returned a generic unavailable response. Relaunch to re-check access and current object state."
          statusLabel="Unavailable"
          statusVariant="outline"
          testId="password-manager-state-object-unavailable"
          actions={
            <Button variant="outline" onClick={onRetry}>
              Retry launch
            </Button>
          }
        />
      )
    case 'operational-failure':
      return (
        <ShellCard
          icon={ShieldAlert}
          eyebrow="Operational failure"
          title="Password Manager is temporarily unavailable"
          description="The launch path could not complete safely. Retry after checking the Password Manager service and CT-Ops launch configuration."
          statusLabel="Failure"
          statusVariant="destructive"
          testId="password-manager-state-operational-failure"
          actions={<Button onClick={onRetry}>Retry launch</Button>}
        />
      )
  }
}

function ShellCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  statusLabel,
  statusVariant,
  testId,
  actions,
  footer,
}: {
  icon: typeof RefreshCcw
  eyebrow: string
  title: string
  description: string
  statusLabel: string
  statusVariant: 'secondary' | 'outline' | 'destructive'
  testId: string
  actions?: ReactNode
  footer?: ReactNode
}) {
  return (
    <Card className="overflow-hidden border-border/60 shadow-xs" data-testid={testId}>
      <CardHeader className="gap-3 border-b border-border/60 bg-muted/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/8 text-primary">
              <Icon className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
              <CardTitle>{title}</CardTitle>
            </div>
          </div>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {actions ? (
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3">{actions}</div>
        </CardContent>
      ) : null}
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  )
}

function PasswordManagerWorkspace({
  createVaultDescription,
  createVaultName,
  deferredEntryFilter,
  deferredVaultFilter,
  editingEntryId,
  entries,
  entriesPending,
  entryFilter,
  entryNotes,
  entryPassword,
  entryRevealId,
  entryTitle,
  entryUrl,
  entryUsername,
  onCopyPassword,
  onCreateVault,
  onCreateVaultDescriptionChange,
  onCreateVaultNameChange,
  onDeleteEntry,
  onDeleteVault,
  onEntryFilterChange,
  onEntryNotesChange,
  onEntryPasswordChange,
  onEntryRevealIdChange,
  onEntrySave,
  onEntryTitleChange,
  onEntryUrlChange,
  onEntryUsernameChange,
  onRenameVault,
  onRenameVaultDescriptionChange,
  onRenameVaultNameChange,
  onRetryCreateVault,
  onSelectEntry,
  onSelectVault,
  onStartCreateEntry,
  onStartEditEntry,
  onVaultFilterChange,
  renameVaultDescription,
  renameVaultName,
  selectedEntry,
  selectedVault,
  vaultFilter,
  vaults,
  vaultsPending,
  workspaceError,
  workspacePending,
  workspaceState,
}: {
  createVaultDescription: string
  createVaultName: string
  deferredEntryFilter: string
  deferredVaultFilter: string
  editingEntryId: string | null
  entries: PasswordManagerEntrySummary[]
  entriesPending: boolean
  entryFilter: string
  entryNotes: string
  entryPassword: string
  entryRevealId: string | null
  entryTitle: string
  entryUrl: string
  entryUsername: string
  onCopyPassword: (entry: PasswordManagerEntrySummary) => Promise<void>
  onCreateVault: () => Promise<void>
  onCreateVaultDescriptionChange: (value: string) => void
  onCreateVaultNameChange: (value: string) => void
  onDeleteEntry: () => Promise<void>
  onDeleteVault: () => Promise<void>
  onEntryFilterChange: (value: string) => void
  onEntryNotesChange: (value: string) => void
  onEntryPasswordChange: (value: string) => void
  onEntryRevealIdChange: (value: string | null) => void
  onEntrySave: () => Promise<void>
  onEntryTitleChange: (value: string) => void
  onEntryUrlChange: (value: string) => void
  onEntryUsernameChange: (value: string) => void
  onRenameVault: () => Promise<void>
  onRenameVaultDescriptionChange: (value: string) => void
  onRenameVaultNameChange: (value: string) => void
  onRetryCreateVault: () => Promise<void>
  onSelectEntry: (entryId: string | null) => void
  onSelectVault: (vaultId: string) => void
  onStartCreateEntry: () => void
  onStartEditEntry: (entry: PasswordManagerEntrySummary) => void
  onVaultFilterChange: (value: string) => void
  renameVaultDescription: string
  renameVaultName: string
  selectedEntry: PasswordManagerEntrySummary | null
  selectedVault: PasswordManagerVaultSummary | null
  vaultFilter: string
  vaults: PasswordManagerVaultSummary[]
  vaultsPending: boolean
  workspaceError: string | null
  workspacePending: boolean
  workspaceState: PasswordManagerWorkspaceState
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]" data-testid="password-manager-workspace">
      <Card className="border-border/60 shadow-xs">
        <CardHeader>
          <CardTitle>Vaults</CardTitle>
          <CardDescription>Filter and manage vault names locally after decrypting metadata in browser memory.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={vaultFilter}
              onChange={(event) => onVaultFilterChange(event.target.value)}
              placeholder="Filter vaults locally"
              data-testid="password-manager-vault-filter"
            />
          </div>
          <div className="space-y-2">
            {vaultsPending ? <p className="text-sm text-muted-foreground">Loading encrypted vault metadata…</p> : null}
            {!vaultsPending && vaults.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No vaults match <span className="font-medium">{deferredVaultFilter || 'the current view'}</span>.
              </p>
            ) : null}
            {vaults.map((vault) => (
              <button
                key={vault.id}
                type="button"
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                  selectedVault?.id === vault.id ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-primary/40'
                }`}
                onClick={() => onSelectVault(vault.id)}
                data-testid={`password-manager-vault-${vault.id}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-foreground">{vault.metadata.name}</p>
                  <Badge variant="outline">{vault.role}</Badge>
                </div>
                {vault.metadata.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{vault.metadata.description}</p>
                ) : null}
              </button>
            ))}
          </div>
          <Separator />
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Plus className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium">Create vault</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password-manager-vault-name">Vault name</Label>
              <Input
                id="password-manager-vault-name"
                value={createVaultName}
                onChange={(event) => onCreateVaultNameChange(event.target.value)}
                placeholder="Shared production"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password-manager-vault-description">Description</Label>
              <Textarea
                id="password-manager-vault-description"
                value={createVaultDescription}
                onChange={(event) => onCreateVaultDescriptionChange(event.target.value)}
                placeholder="Who should use this vault and for what"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void onCreateVault()} disabled={workspacePending}>
                {workspacePending ? 'Saving…' : 'Create encrypted vault'}
              </Button>
              <Button variant="outline" onClick={() => void onRetryCreateVault()} disabled={workspacePending}>
                Retry same request
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {workspaceError ? (
          <Alert variant={workspaceState.view === 'object-unavailable' ? 'destructive' : 'default'}>
            <AlertCircle className="size-4" />
            <AlertTitle>
              {workspaceState.view === 'object-unavailable' ? 'Object unavailable' : 'Workspace status'}
            </AlertTitle>
            <AlertDescription>{workspaceError}</AlertDescription>
          </Alert>
        ) : null}

        {selectedVault ? (
          <Card className="border-border/60 shadow-xs">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>{selectedVault.metadata.name}</CardTitle>
                  <CardDescription>Rename or remove this vault. Only encrypted metadata leaves the browser.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary">Key epoch {selectedVault.currentKeyEpoch}</Badge>
                  <Badge variant="outline">{selectedVault.role}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="password-manager-vault-rename-name">Vault name</Label>
                <Input
                  id="password-manager-vault-rename-name"
                  value={renameVaultName}
                  onChange={(event) => onRenameVaultNameChange(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password-manager-vault-rename-description">Description</Label>
                <Textarea
                  id="password-manager-vault-rename-description"
                  value={renameVaultDescription}
                  onChange={(event) => onRenameVaultDescriptionChange(event.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void onRenameVault()} disabled={workspacePending}>
                <Pencil className="mr-2 size-4" />
                Rename vault
              </Button>
              <Button variant="destructive" onClick={() => void onDeleteVault()} disabled={workspacePending}>
                <Trash2 className="mr-2 size-4" />
                Delete vault
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <Card className="border-dashed border-border/60 shadow-xs">
            <CardHeader>
              <CardTitle>Select or create a vault</CardTitle>
              <CardDescription>
                Password Manager filtering stays local in browser memory after the encrypted records are decrypted.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <Card className="border-border/60 shadow-xs">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Entries</CardTitle>
                <CardDescription>Reveal, copy, and edit entry payloads without sending plaintext back to the API.</CardDescription>
              </div>
              <Button variant="outline" onClick={onStartCreateEntry} disabled={!selectedVault || workspacePending}>
                <Plus className="mr-2 size-4" />
                New entry
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={entryFilter}
                onChange={(event) => onEntryFilterChange(event.target.value)}
                placeholder="Filter entries locally"
                disabled={!selectedVault}
                data-testid="password-manager-entry-filter"
              />
            </div>
            {entriesPending ? <p className="text-sm text-muted-foreground">Loading encrypted entries…</p> : null}
            {!entriesPending && selectedVault && entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No entries match <span className="font-medium">{deferredEntryFilter || 'the current view'}</span>.
              </p>
            ) : null}
            <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-2">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-2xl border px-4 py-3 ${
                      selectedEntry?.id === entry.id ? 'border-primary bg-primary/5' : 'border-border/60'
                    }`}
                    data-testid={`password-manager-entry-${entry.id}`}
                  >
                    <button type="button" className="w-full text-left" onClick={() => onSelectEntry(entry.id)}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{entry.payload.title}</p>
                        <Badge variant="outline">Epoch {entry.keyEpoch}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{entry.payload.username}</p>
                      {entry.payload.url ? <p className="text-xs text-muted-foreground">{entry.payload.url}</p> : null}
                    </button>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEntryRevealIdChange(entryRevealId === entry.id ? null : entry.id)}
                      >
                        {entryRevealId === entry.id ? <EyeOff className="mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
                        {entryRevealId === entry.id ? 'Hide password' : 'Reveal password'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void onCopyPassword(entry)}>
                        <Copy className="mr-2 size-4" />
                        Copy password
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => onStartEditEntry(entry)}>
                        <Pencil className="mr-2 size-4" />
                        Edit
                      </Button>
                    </div>
                    {entryRevealId === entry.id ? (
                      <p className="mt-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 font-mono text-sm">
                        {entry.payload.password}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-border/60 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{editingEntryId ? 'Edit entry' : 'Create entry'}</p>
                    <p className="text-sm text-muted-foreground">
                      {editingEntryId ? 'Updating re-encrypts the entire payload.' : 'The payload is encrypted locally before upload.'}
                    </p>
                  </div>
                  {selectedEntry ? (
                    <Button variant="ghost" size="sm" onClick={() => onSelectEntry(null)}>
                      Clear selection
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="password-manager-entry-title">Title</Label>
                    <Input
                      id="password-manager-entry-title"
                      value={entryTitle}
                      onChange={(event) => onEntryTitleChange(event.target.value)}
                      disabled={!selectedVault}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password-manager-entry-username">Username</Label>
                    <Input
                      id="password-manager-entry-username"
                      value={entryUsername}
                      onChange={(event) => onEntryUsernameChange(event.target.value)}
                      disabled={!selectedVault}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password-manager-entry-password">Password</Label>
                    <Input
                      id="password-manager-entry-password"
                      type="password"
                      value={entryPassword}
                      onChange={(event) => onEntryPasswordChange(event.target.value)}
                      disabled={!selectedVault}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password-manager-entry-url">URL</Label>
                    <Input
                      id="password-manager-entry-url"
                      value={entryUrl}
                      onChange={(event) => onEntryUrlChange(event.target.value)}
                      disabled={!selectedVault}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password-manager-entry-notes">Notes</Label>
                    <Textarea
                      id="password-manager-entry-notes"
                      value={entryNotes}
                      onChange={(event) => onEntryNotesChange(event.target.value)}
                      disabled={!selectedVault}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void onEntrySave()} disabled={!selectedVault || workspacePending}>
                      {workspacePending ? 'Saving…' : editingEntryId ? 'Save encrypted entry' : 'Create encrypted entry'}
                    </Button>
                    {selectedEntry ? (
                      <Button variant="destructive" onClick={() => void onDeleteEntry()} disabled={workspacePending}>
                        <Trash2 className="mr-2 size-4" />
                        Delete entry
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
