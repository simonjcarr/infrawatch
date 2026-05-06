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
  Check,
  ChevronsUpDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  RotateCcw,
  KeyRound,
  Lock,
  LogOut,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  Vault,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { logWarn } from '@/lib/logging'
import {
  createEncryptedEntryPayload,
  createEncryptedVaultMetadata,
  createUnlockProfile,
  decryptEntryPayload,
  decryptVaultMetadata,
  decryptUserPrivateKeyEnvelope,
  exportPublicKeyEnvelope,
  generateVaultKey,
  importPublicKeyEnvelope,
  type PasswordManagerEncryptedPrivateKeyEnvelope,
  type PasswordManagerEncryptedPayloadEnvelope,
  type PasswordManagerKdfMetadata,
  type PasswordManagerPublicKeyEnvelope,
  type PasswordManagerWrappedVaultKeyEnvelope,
  unwrapVaultKeyEnvelope,
  wrapVaultKeyForMember,
} from '@/lib/password-manager/browser-crypto'
import {
  PasswordManagerApiError,
  type EntryRecord,
  type MemberRecord,
  type MemberRecipientRecord,
  type VaultRecord,
  createPasswordManagerClient,
} from '@/lib/password-manager/client'
import { normalizePasswordManagerUiError, shouldLogPasswordManagerError } from '@/lib/password-manager/errors'
import { createPasswordManagerVaultExportBundle } from '@/lib/password-manager/export'
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
const PASSWORD_MANAGER_MEMBER_ROLES = ['viewer', 'member', 'manager', 'owner'] as const
const PASSWORD_MANAGER_CRYPTO_BATCH_SIZE = 8

export type PasswordManagerOrganisationUser = {
  id: string
  name: string | null
  email: string
}

function toClientPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isMembershipConflictError(error: unknown): boolean {
  return error instanceof PasswordManagerApiError && error.status === 409 && error.code === 'membership_conflict'
}

function canManageVaultRole(role: string): boolean {
  return role === 'owner' || role === 'manager'
}

function sortMembers(members: MemberRecord[]): MemberRecord[] {
  return [...members].sort((left, right) => {
    if (left.role !== right.role) {
      return PASSWORD_MANAGER_MEMBER_ROLES.indexOf(right.role as (typeof PASSWORD_MANAGER_MEMBER_ROLES)[number]) -
        PASSWORD_MANAGER_MEMBER_ROLES.indexOf(left.role as (typeof PASSWORD_MANAGER_MEMBER_ROLES)[number])
    }
    return left.user_id.localeCompare(right.user_id)
  })
}

function upsertVaultEpochKey(vaultKeyCache: Map<string, Map<number, CryptoKey>>, vaultId: string, epoch: number, key: CryptoKey) {
  const existing = vaultKeyCache.get(vaultId) ?? new Map<number, CryptoKey>()
  existing.set(epoch, key)
  vaultKeyCache.set(vaultId, existing)
}

function readVaultEpochKey(vaultKeyCache: Map<string, Map<number, CryptoKey>>, vaultId: string, epoch: number): CryptoKey | null {
  return vaultKeyCache.get(vaultId)?.get(epoch) ?? null
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  link.click()
  URL.revokeObjectURL(objectUrl)
}

async function yieldToBrowser() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function mapPasswordManagerCryptoBatch<TInput, TOutput>(
  values: TInput[],
  mapper: (value: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = []
  for (let index = 0; index < values.length; index += PASSWORD_MANAGER_CRYPTO_BATCH_SIZE) {
    const batch = values.slice(index, index + PASSWORD_MANAGER_CRYPTO_BATCH_SIZE)
    results.push(...await Promise.all(batch.map(mapper)))
    if (index + PASSWORD_MANAGER_CRYPTO_BATCH_SIZE < values.length) {
      await yieldToBrowser()
    }
  }
  return results
}

export function PasswordManagerClientShell({
  currentUserId,
  orgId,
  organisationUsers,
}: {
  currentUserId: string
  orgId: string
  organisationUsers: PasswordManagerOrganisationUser[]
}) {
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
  const [membersPending, setMembersPending] = useState(false)
  const [workspacePending, setWorkspacePending] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [vaultFilter, setVaultFilter] = useState('')
  const [entryFilter, setEntryFilter] = useState('')
  const deferredVaultFilter = useDeferredValue(vaultFilter)
  const deferredEntryFilter = useDeferredValue(entryFilter)
  const [vaults, setVaults] = useState<PasswordManagerVaultSummary[]>([])
  const [entries, setEntries] = useState<PasswordManagerEntrySummary[]>([])
  const [members, setMembers] = useState<MemberRecord[]>([])
  const [createVaultName, setCreateVaultName] = useState('')
  const [createVaultDescription, setCreateVaultDescription] = useState('')
  const [renameVaultName, setRenameVaultName] = useState('')
  const [renameVaultDescription, setRenameVaultDescription] = useState('')
  const [memberUserId, setMemberUserId] = useState('')
  const [memberRole, setMemberRole] = useState<(typeof PASSWORD_MANAGER_MEMBER_ROLES)[number]>('viewer')
  const [memberRecipients, setMemberRecipients] = useState<Record<string, MemberRecipientRecord>>({})
  const [memberRecipientsPending, setMemberRecipientsPending] = useState(false)
  const [memberRecipientLookupVaultId, setMemberRecipientLookupVaultId] = useState<string | null>(null)
  const [currentPasswordManagerUserId, setCurrentPasswordManagerUserId] = useState<string | null>(null)
  const [memberRoleEdits, setMemberRoleEdits] = useState<Record<string, string>>({})
  const [memberPublicKeyEnvelopeInputs, setMemberPublicKeyEnvelopeInputs] = useState<Record<string, string>>({})
  const [rotationPrompt, setRotationPrompt] = useState<string | null>(null)
  const [entryTitle, setEntryTitle] = useState('')
  const [entryUsername, setEntryUsername] = useState('')
  const [entryPassword, setEntryPassword] = useState('')
  const [entryUrl, setEntryUrl] = useState('')
  const [entryNotes, setEntryNotes] = useState('')
  const [entryRevealId, setEntryRevealId] = useState<string | null>(null)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const vaultKeyCacheRef = useRef(new Map<string, Map<number, CryptoKey>>())
  const memberPublicKeyEnvelopeCacheRef = useRef<Record<string, PasswordManagerPublicKeyEnvelope>>({})
  const pendingVaultCreateRef = useRef<{
    encryptedMetadata: PasswordManagerEncryptedPayloadEnvelope
    metadata: PasswordManagerVaultMetadata
    wrappedVaultKeyEnvelope: PasswordManagerWrappedVaultKeyEnvelope
    idempotencyKey: string
    vaultKey: CryptoKey
  } | null>(null)
  const pendingRotationRef = useRef<{
    idempotencyKey: string
    members: Array<{ userId: string; wrappedVaultKeyEnvelope: PasswordManagerWrappedVaultKeyEnvelope }>
    vaultId: string
    vaultKey: CryptoKey
  } | null>(null)

  const filteredVaults = useMemo(
    () => filterPasswordManagerVaults(vaults, deferredVaultFilter),
    [deferredVaultFilter, vaults],
  )
  const selectedVault = vaults.find((vault) => vault.id === workspaceState.selectedVaultId) ?? null
  const filteredEntries = useMemo(
    () => filterPasswordManagerEntries(entries, deferredEntryFilter),
    [deferredEntryFilter, entries],
  )
  const selectedEntry = entries.find((entry) => entry.id === workspaceState.selectedEntryId) ?? null
  const selectedVaultIdRef = useRef(workspaceState.selectedVaultId)
  const selectedEntryIdRef = useRef(workspaceState.selectedEntryId)

  function logPasswordManagerWarning(message: string, error: unknown, context?: unknown) {
    if (!shouldLogPasswordManagerError(error)) {
      return
    }
    logWarn(message, error, context)
  }

  function handleWorkspaceUiError(error: unknown, fallbackMessage: string) {
    const normalized = normalizePasswordManagerUiError(error, fallbackMessage)

    if (normalized.kind === 'shell-view') {
      dispatch({
        type: 'launch-failed',
        view: normalized.view,
      })
      return
    }

    if (normalized.kind === 'object-unavailable') {
      workspaceDispatch({ type: 'object-unavailable' })
      setWorkspaceError(normalized.message)
      return
    }

    setWorkspaceError(normalized.message)
  }

  function recordAuditHookFailure(actionLabel: string, error: unknown) {
    const normalized = normalizePasswordManagerUiError(
      error,
      `The ${actionLabel} completed locally, but the audit hook could not be recorded safely.`,
    )

    if (normalized.kind === 'shell-view') {
      dispatch({
        type: 'launch-failed',
        view: normalized.view,
      })
      return
    }

    if (normalized.kind === 'object-unavailable') {
      workspaceDispatch({ type: 'object-unavailable' })
      setWorkspaceError(normalized.message)
      return
    }

    setWorkspaceError(normalized.message)
  }

  const handleWorkspaceEffectError = useEffectEvent((error: unknown, fallbackMessage: string) => {
    logPasswordManagerWarning('[password-manager] workspace operation failed', error, {
      organisationId: state.organisationId,
      selectedVaultId: workspaceState.selectedVaultId,
      selectedEntryId: workspaceState.selectedEntryId,
    })
    handleWorkspaceUiError(error, fallbackMessage)
  })

  function handleWorkspaceActionError(error: unknown, fallbackMessage: string) {
    logPasswordManagerWarning('[password-manager] workspace operation failed', error, {
      organisationId: state.organisationId,
      selectedVaultId: workspaceState.selectedVaultId,
      selectedEntryId: workspaceState.selectedEntryId,
    })
    handleWorkspaceUiError(error, fallbackMessage)
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
        logPasswordManagerWarning('[password-manager] route shell launch failed', error, {
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

        const normalized = normalizePasswordManagerUiError(
          error,
          'Password Manager could not load the unlock profile metadata safely.',
        )
        if (normalized.kind !== 'message') {
          dispatch({
            type: 'launch-failed',
            view: normalized.view,
          })
          return
        }

        dispatch({
          type: 'unlock-failed',
          message: normalized.message,
          needsRelaunch: false,
        })
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
    memberPublicKeyEnvelopeCacheRef.current = {}
    pendingVaultCreateRef.current = null
    pendingRotationRef.current = null
    setVaults([])
    setEntries([])
    setMembers([])
    setVaultFilter('')
    setEntryFilter('')
    setCreateVaultName('')
    setCreateVaultDescription('')
    setRenameVaultName('')
    setRenameVaultDescription('')
    setMemberUserId('')
    setMemberRole('viewer')
    setMemberRecipients({})
    setMemberRecipientsPending(false)
    setMemberRecipientLookupVaultId(null)
    setCurrentPasswordManagerUserId(null)
    setMemberRoleEdits({})
    setMemberPublicKeyEnvelopeInputs({})
    setRotationPrompt(null)
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

    async function cacheCurrentUserPublicKey() {
      const envelope = await exportPublicKeyEnvelope(state.activeKeyPair!.publicKey as CryptoKey)
      if (cancelled) {
        return
      }
      memberPublicKeyEnvelopeCacheRef.current = {
        ...memberPublicKeyEnvelopeCacheRef.current,
        [currentUserId]: envelope,
        ...(currentPasswordManagerUserId ? { [currentPasswordManagerUserId]: envelope } : {}),
      }
    }

    void cacheCurrentUserPublicKey()

    return () => {
      cancelled = true
    }
  }, [currentPasswordManagerUserId, currentUserId, state.activeKeyPair, state.view])

  useEffect(() => {
    selectedVaultIdRef.current = workspaceState.selectedVaultId
  }, [workspaceState.selectedVaultId])

  useEffect(() => {
    selectedEntryIdRef.current = workspaceState.selectedEntryId
  }, [workspaceState.selectedEntryId])

  useEffect(() => {
    setMemberRecipients({})
    setMemberRecipientsPending(false)
    setMemberRecipientLookupVaultId(null)
    setMemberUserId('')
  }, [workspaceState.selectedVaultId])

  useEffect(() => {
    if (
      state.view !== 'unlocked' ||
      !selectedVault ||
      !canManageVaultRole(selectedVault.role) ||
      memberRecipientLookupVaultId !== selectedVault.id
    ) {
      setMemberRecipients({})
      setMemberRecipientsPending(false)
      return
    }

    const externalUserIds = organisationUsers.map((user) => user.id)
    if (externalUserIds.length === 0) {
      setMemberRecipients({})
      setMemberRecipientsPending(false)
      return
    }

    let cancelled = false

    async function loadMemberRecipients() {
      setMemberRecipientsPending(true)
      try {
        const chunks: string[][] = []
        for (let index = 0; index < externalUserIds.length; index += 100) {
          chunks.push(externalUserIds.slice(index, index + 100))
        }
        const responses = await Promise.all(
          chunks.map((chunk) =>
            client.lookupMemberRecipients({
              vaultId: selectedVault!.id,
              externalUserIds: chunk,
            }),
          ),
        )
        if (cancelled) {
          return
        }

        const nextRecipients: Record<string, MemberRecipientRecord> = {}
        const nextEnvelopeCache: Record<string, PasswordManagerPublicKeyEnvelope> = {}
        let nextCurrentPasswordManagerUserId: string | null = null
        for (const recipient of responses.flatMap((response) => response.recipients)) {
          nextRecipients[recipient.external_user_id] = recipient
          if (recipient.external_user_id === currentUserId) {
            nextCurrentPasswordManagerUserId = recipient.user_id
          }
          if (recipient.setup_configured && recipient.public_key_envelope) {
            nextEnvelopeCache[recipient.user_id] = recipient.public_key_envelope as unknown as PasswordManagerPublicKeyEnvelope
          }
        }

        setMemberRecipients(nextRecipients)
        setCurrentPasswordManagerUserId(nextCurrentPasswordManagerUserId)
        memberPublicKeyEnvelopeCacheRef.current = {
          ...memberPublicKeyEnvelopeCacheRef.current,
          ...nextEnvelopeCache,
        }
        setMemberPublicKeyEnvelopeInputs((current) => {
          const next = { ...current }
          for (const [userId, envelope] of Object.entries(nextEnvelopeCache)) {
            next[userId] = JSON.stringify(envelope, null, 2)
          }
          return next
        })
      } catch (error) {
        if (!cancelled) {
          handleWorkspaceEffectError(error, 'Password Manager member recipients could not be loaded safely.')
        }
      } finally {
        if (!cancelled) {
          setMemberRecipientsPending(false)
        }
      }
    }

    void loadMemberRecipients()

    return () => {
      cancelled = true
    }
  }, [client, currentUserId, memberRecipientLookupVaultId, organisationUsers, selectedVault, state.view])

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
        const decryptedVaults = await mapPasswordManagerCryptoBatch(
          response.vaults,
          async (record) => {
            const vaultKey = await unwrapVaultKeyEnvelope(
              record.wrapped_vault_key_envelope as unknown as PasswordManagerWrappedVaultKeyEnvelope,
              state.activeKeyPair!.privateKey as CryptoKey,
            )
            const metadata = await decryptVaultMetadata(
              record.encrypted_metadata as unknown as PasswordManagerEncryptedPayloadEnvelope,
              vaultKey,
            )
            upsertVaultEpochKey(vaultKeyCacheRef.current, record.id, record.current_key_epoch, vaultKey)
            return createVaultSummary(record, metadata)
          },
        )
        if (cancelled) {
          return
        }

        const visibleVaultIds = new Set(decryptedVaults.map((vault) => vault.id))
        for (const vaultId of [...vaultKeyCacheRef.current.keys()]) {
          if (!visibleVaultIds.has(vaultId)) {
            vaultKeyCacheRef.current.delete(vaultId)
          }
        }

        setVaults(decryptedVaults)
        const currentSelectedVaultId = selectedVaultIdRef.current
        const preferredVaultId =
          decryptedVaults.find((vault) => vault.id === currentSelectedVaultId)?.id ?? decryptedVaults[0]?.id ?? null
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
  }, [client, state.activeKeyPair, state.launchNonce, state.view])

  useEffect(() => {
    if (state.view !== 'unlocked' || !workspaceState.selectedVaultId) {
      setEntries([])
      return
    }

    let cancelled = false

    async function loadEntries() {
      setEntriesPending(true)
      setWorkspaceError(null)
      try {
        const response = await client.listEntries(workspaceState.selectedVaultId!)
        const decryptedEntries = await mapPasswordManagerCryptoBatch(
          response.entries,
          async (record) => {
            const vaultKey = readVaultEpochKey(vaultKeyCacheRef.current, record.vault_id, record.key_epoch)
            if (!vaultKey) {
              throw new Error('The required vault key epoch is no longer available in browser memory. Rotate or relaunch.')
            }
            return createEntrySummary(
              record,
              await decryptEntryPayload<PasswordManagerEntryPayload>(
                record.encrypted_payload as unknown as PasswordManagerEncryptedPayloadEnvelope,
                vaultKey,
              ),
            )
          },
        )
        if (cancelled) {
          return
        }

        setEntries(decryptedEntries)
        const currentSelectedEntryId = selectedEntryIdRef.current
        if (!decryptedEntries.find((entry) => entry.id === currentSelectedEntryId)) {
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
  }, [client, state.view, workspaceState.selectedVaultId])

  useEffect(() => {
    if (state.view !== 'unlocked' || !workspaceState.selectedVaultId) {
      setMembers([])
      return
    }

    let cancelled = false

    async function loadMembers() {
      setMembersPending(true)
      setWorkspaceError(null)
      try {
        const response = await client.listMembers(workspaceState.selectedVaultId!)
        if (cancelled) {
          return
        }

        const nextMembers = sortMembers(response.members)
        setMembers(nextMembers)
        setMemberRoleEdits(Object.fromEntries(nextMembers.map((member) => [member.user_id, member.role])))
      } catch (error) {
        if (cancelled) {
          return
        }
        handleWorkspaceEffectError(error, 'Password Manager members could not be loaded safely.')
      } finally {
        if (!cancelled) {
          setMembersPending(false)
        }
      }
    }

    void loadMembers()

    return () => {
      cancelled = true
    }
  }, [client, state.view, workspaceState.selectedVaultId])

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
        if (error.status === 401 || error.status === 403 || error.status === 404 || error.status >= 500) {
          const normalized = normalizePasswordManagerUiError(error, GENERIC_SETUP_FAILURE)
          if (normalized.kind !== 'message') {
            dispatch({
              type: 'launch-failed',
              view: normalized.view,
            })
            return
          }
        }
      }

      const normalized = normalizePasswordManagerUiError(error, GENERIC_SETUP_FAILURE)
      logPasswordManagerWarning('[password-manager] setup failed', error, {
        organisationId: state.organisationId,
      })
      dispatch({
        type: 'setup-failed',
        message: normalized.message,
      })
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
      logPasswordManagerWarning('[password-manager] unlock failed', error, {
        organisationId: state.organisationId,
      })
      const normalized = normalizePasswordManagerUiError(error, GENERIC_UNLOCK_FAILURE)
      if (normalized.kind !== 'message') {
        dispatch({
          type: 'launch-failed',
          view: normalized.view,
        })
        return
      }
      dispatch({
        type: 'unlock-failed',
        message: normalized.message,
        needsRelaunch: false,
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
      logPasswordManagerWarning('[password-manager] session refresh failed', error, {
        organisationId: state.organisationId,
      })
      const normalized = normalizePasswordManagerUiError(
        error,
        'Password Manager could not refresh the current session safely.',
      )
      if (normalized.kind !== 'message') {
        dispatch({
          type: 'launch-failed',
          view: normalized.view,
        })
        return
      }
      setStatusNotice(normalized.message)
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
      logPasswordManagerWarning('[password-manager] logout failed', error, {
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
      upsertVaultEpochKey(vaultKeyCacheRef.current, summary.id, summary.currentKeyEpoch, request.vaultKey)
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
    const vaultKey = readVaultEpochKey(vaultKeyCacheRef.current, selectedVault.id, selectedVault.currentKeyEpoch)
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
      setMembers([])
      workspaceDispatch({ type: 'vault-removed', vaultId: selectedVault.id })
      setStatusNotice('Vault removed and decrypted browser state cleared for that vault.')
    } catch (error) {
      handleWorkspaceActionError(error, 'The vault could not be deleted safely.')
    } finally {
      setWorkspacePending(false)
    }
  }

  async function handleMemberAdd() {
    if (!selectedVault) {
      setWorkspaceError('Select a vault before adding a member.')
      return
    }
    const vaultKey = readVaultEpochKey(vaultKeyCacheRef.current, selectedVault.id, selectedVault.currentKeyEpoch)
    if (!vaultKey) {
      setWorkspaceError('The selected vault key is no longer available in browser memory. Relock or relaunch.')
      return
    }

    const externalUserId = memberUserId.trim()
    if (!externalUserId) {
      setWorkspaceError('Select an organisation user to add as a member.')
      return
    }

    const recipient = memberRecipients[externalUserId]
    if (!recipient) {
      setWorkspaceError('Password Manager has not seen that organisation user yet. Ask them to launch Password Manager once, then retry.')
      return
    }
    if (!recipient.setup_configured || !recipient.public_key_envelope) {
      setWorkspaceError('That user has not set up Password Manager yet. Ask them to launch and set up Password Manager before adding them.')
      return
    }

    setWorkspacePending(true)
    setWorkspaceError(null)
    try {
      const parsedEnvelope = recipient.public_key_envelope as unknown as PasswordManagerPublicKeyEnvelope
      const memberPublicKey = await importPublicKeyEnvelope(parsedEnvelope)
      const wrappedVaultKeyEnvelope = await wrapVaultKeyForMember(vaultKey, memberPublicKey)
      const created = await client.addMember({
        vaultId: selectedVault.id,
        userId: recipient.user_id,
        role: memberRole,
        wrappedVaultKeyEnvelope: toClientPayload(wrappedVaultKeyEnvelope) as never,
        keyEpoch: selectedVault.currentKeyEpoch,
      })
      memberPublicKeyEnvelopeCacheRef.current = {
        ...memberPublicKeyEnvelopeCacheRef.current,
        [created.user_id]: parsedEnvelope,
      }
      setMembers((current) => sortMembers([...current.filter((member) => member.user_id !== created.user_id), created]))
      setMemberRoleEdits((current) => ({ ...current, [created.user_id]: created.role }))
      setMemberPublicKeyEnvelopeInputs((current) => ({ ...current, [created.user_id]: JSON.stringify(parsedEnvelope, null, 2) }))
      setMemberUserId('')
      setMemberRole('viewer')
      setStatusNotice('Member added with a wrapped vault key only.')
    } catch (error) {
      if (isMembershipConflictError(error)) {
        setWorkspaceError('Password Manager rejected that membership change because owner safety or current membership state would be violated. Refresh and retry.')
      } else {
        handleWorkspaceActionError(error, 'The member could not be added safely.')
      }
    } finally {
      setWorkspacePending(false)
    }
  }

  async function handleMemberRoleUpdate(member: MemberRecord) {
    if (!selectedVault) {
      return
    }

    const nextRole = memberRoleEdits[member.user_id] ?? member.role
    if (nextRole === member.role) {
      setStatusNotice(`No role change was needed for ${member.user_id}.`)
      return
    }

    setWorkspacePending(true)
    setWorkspaceError(null)
    try {
      const updated = await client.updateMember({
        vaultId: selectedVault.id,
        userId: member.user_id,
        role: nextRole,
        wrappedVaultKeyEnvelope: toClientPayload(member.wrapped_vault_key_envelope) as never,
        keyEpoch: member.key_epoch,
      })
      setMembers((current) => sortMembers(current.map((entry) => (entry.user_id === updated.user_id ? updated : entry))))
      setMemberRoleEdits((current) => ({ ...current, [updated.user_id]: updated.role }))
      setStatusNotice(`Role updated safely for ${updated.user_id}.`)
    } catch (error) {
      if (isMembershipConflictError(error)) {
        setWorkspaceError('Password Manager rejected that membership change because owner safety or current membership state would be violated. Refresh and retry.')
      } else {
        handleWorkspaceActionError(error, 'The member role could not be updated safely.')
      }
    } finally {
      setWorkspacePending(false)
    }
  }

  async function runVaultRotation(
    request = pendingRotationRef.current,
  ) {
    if (!selectedVault || !state.activeKeyPair) {
      setWorkspaceError('Unlock Password Manager and select a vault before rotating keys.')
      return
    }

    if (!request) {
      if (members.length === 0) {
        setWorkspaceError('No active members remain to receive the next wrapped vault key.')
        return
      }

      const vaultKey = await generateVaultKey()
      const rotatedMembers: Array<{ userId: string; wrappedVaultKeyEnvelope: PasswordManagerWrappedVaultKeyEnvelope }> = []

      for (const member of members) {
        let memberPublicKey: CryptoKey
        if (member.user_id === currentPasswordManagerUserId) {
          memberPublicKey = state.activeKeyPair.publicKey as CryptoKey
        } else {
          const cachedEnvelope = memberPublicKeyEnvelopeCacheRef.current[member.user_id]
          const pastedEnvelope = memberPublicKeyEnvelopeInputs[member.user_id]?.trim()
          const envelope = cachedEnvelope ?? (pastedEnvelope ? (JSON.parse(pastedEnvelope) as PasswordManagerPublicKeyEnvelope) : null)
          if (!envelope) {
            setWorkspaceError(`Paste the Password Manager public-key envelope for ${member.user_id} before rotating this vault key.`)
            return
          }
          memberPublicKey = await importPublicKeyEnvelope(envelope)
          memberPublicKeyEnvelopeCacheRef.current = {
            ...memberPublicKeyEnvelopeCacheRef.current,
            [member.user_id]: envelope,
          }
        }

        rotatedMembers.push({
          userId: member.user_id,
          wrappedVaultKeyEnvelope: await wrapVaultKeyForMember(vaultKey, memberPublicKey),
        })
      }

      request = {
        idempotencyKey: createIdempotencyKey(),
        members: rotatedMembers,
        vaultId: selectedVault.id,
        vaultKey,
      }
      pendingRotationRef.current = request
    }

    setWorkspacePending(true)
    setWorkspaceError(null)
    try {
      const rotated = await client.rotateVaultKeys({
        vaultId: request.vaultId,
        rotationReason: 'membership_revoked',
        members: request.members.map((member) => ({
          userId: member.userId,
          wrappedVaultKeyEnvelope: toClientPayload(member.wrappedVaultKeyEnvelope) as never,
        })),
        idempotencyKey: request.idempotencyKey,
      })
      upsertVaultEpochKey(vaultKeyCacheRef.current, request.vaultId, rotated.epoch, request.vaultKey)
      setVaults((current) =>
        current.map((vault) =>
          vault.id === request.vaultId
            ? {
                ...vault,
                currentKeyEpoch: rotated.epoch,
                updatedAt: rotated.created_at,
              }
            : vault,
        ),
      )
      setMembers((current) =>
        sortMembers(
          current.map((member) =>
            request!.members.find((candidate) => candidate.userId === member.user_id)
              ? { ...member, key_epoch: rotated.epoch, updated_at: rotated.created_at }
              : member,
          ),
        ),
      )
      pendingRotationRef.current = null
      setRotationPrompt(null)
      setStatusNotice('Vault key rotated safely for the current active members.')
    } catch (error) {
      handleWorkspaceActionError(error, 'The vault key could not be rotated safely. Retry the same encrypted request.')
    } finally {
      setWorkspacePending(false)
    }
  }

  async function handleMemberRemove(member: MemberRecord) {
    if (!selectedVault) {
      return
    }

    setWorkspacePending(true)
    setWorkspaceError(null)
    try {
      await client.removeMember({
        vaultId: selectedVault.id,
        userId: member.user_id,
      })

      if (member.user_id === currentPasswordManagerUserId) {
        vaultKeyCacheRef.current.delete(selectedVault.id)
        setVaults((current) => current.filter((vault) => vault.id !== selectedVault.id))
        setEntries([])
        setMembers([])
        workspaceDispatch({ type: 'vault-removed', vaultId: selectedVault.id })
        setStatusNotice('Your access to this vault was removed. Local decrypted state was purged immediately.')
        return
      }

      pendingRotationRef.current = null
      setMembers((current) => sortMembers(current.filter((entry) => entry.user_id !== member.user_id)))
      setMemberRoleEdits((current) => {
        const next = { ...current }
        delete next[member.user_id]
        return next
      })
      setRotationPrompt(`Rotate the vault key now that ${member.user_id} no longer has access.`)
      setStatusNotice('Member removed. Rotate the vault key before adding or updating more secrets.')
    } catch (error) {
      if (isMembershipConflictError(error)) {
        setWorkspaceError('Password Manager rejected that membership change because owner safety or current membership state would be violated. Refresh and retry.')
      } else {
        handleWorkspaceActionError(error, 'The member could not be removed safely.')
      }
    } finally {
      setWorkspacePending(false)
    }
  }

  async function handleEntrySave() {
    if (!workspaceState.selectedVaultId || !selectedVault) {
      setWorkspaceError('Select a vault before saving an entry.')
      return
    }
    const vaultKey = readVaultEpochKey(vaultKeyCacheRef.current, workspaceState.selectedVaultId, selectedVault.currentKeyEpoch)
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
      await client.auditCopy({
        vaultId: entry.vaultId,
        entryId: entry.id,
      })
    } catch (error) {
      if (!(error instanceof PasswordManagerApiError)) {
        handleWorkspaceActionError(error, 'The password could not be copied safely in this browser.')
        return
      }

      logPasswordManagerWarning('[password-manager] copy audit failed', error, {
        organisationId: state.organisationId,
        selectedVaultId: entry.vaultId,
        selectedEntryId: entry.id,
      })
      recordAuditHookFailure('password copy', error)
    }
  }

  async function handleEntryRevealToggle(entry: PasswordManagerEntrySummary) {
    if (entryRevealId === entry.id) {
      setEntryRevealId(null)
      return
    }

    setEntryRevealId(entry.id)
    setStatusNotice(`Password revealed locally for ${entry.payload.title}.`)

    try {
      await client.auditReveal({
        vaultId: entry.vaultId,
        entryId: entry.id,
      })
    } catch (error) {
      logPasswordManagerWarning('[password-manager] reveal audit failed', error, {
        organisationId: state.organisationId,
        selectedVaultId: entry.vaultId,
        selectedEntryId: entry.id,
      })
      recordAuditHookFailure('password reveal', error)
    }
  }

  async function handleVaultExport() {
    if (!selectedVault) {
      setWorkspaceError('Select a vault before exporting it.')
      return
    }

    setWorkspacePending(true)
    setWorkspaceError(null)
    try {
      const bundle = createPasswordManagerVaultExportBundle({
        vault: selectedVault,
        entries: entries.filter((entry) => entry.vaultId === selectedVault.id),
      })
      triggerBlobDownload(bundle.blob, bundle.fileName)
      setStatusNotice(`Vault export packaged locally for ${selectedVault.metadata.name}.`)
      await client.auditExport({
        vaultId: selectedVault.id,
      })
    } catch (error) {
      if (error instanceof PasswordManagerApiError) {
        logPasswordManagerWarning('[password-manager] export audit failed', error, {
          organisationId: state.organisationId,
          selectedVaultId: selectedVault.id,
        })
        recordAuditHookFailure('vault export', error)
        return
      }

      handleWorkspaceActionError(error, 'The vault could not be exported safely.')
    } finally {
      setWorkspacePending(false)
    }
  }

  function handleMemberRecipientLookupRequest() {
    if (!selectedVault || !canManageVaultRole(selectedVault.role)) {
      return
    }

    setMemberRecipientLookupVaultId((current) => current ?? selectedVault.id)
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
          currentPasswordManagerUserId={currentPasswordManagerUserId}
          deferredEntryFilter={deferredEntryFilter}
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
          memberPublicKeyEnvelopeInputs={memberPublicKeyEnvelopeInputs}
          memberRecipients={memberRecipients}
          memberRecipientsPending={memberRecipientsPending}
          memberRole={memberRole}
          memberRoleEdits={memberRoleEdits}
          memberUserId={memberUserId}
          members={members}
          membersPending={membersPending}
          organisationUsers={organisationUsers}
          onCopyPassword={handleCopyPassword}
          onCreateVault={runVaultCreate}
          onCreateVaultDescriptionChange={setCreateVaultDescription}
          onCreateVaultNameChange={setCreateVaultName}
          onDeleteEntry={handleEntryDelete}
          onDeleteVault={handleVaultDelete}
          onEntryFilterChange={setEntryFilter}
          onEntryNotesChange={setEntryNotes}
          onEntryPasswordChange={setEntryPassword}
          onEntrySave={handleEntrySave}
          onEntryTitleChange={setEntryTitle}
          onEntryUrlChange={setEntryUrl}
          onEntryUsernameChange={setEntryUsername}
          onExportVault={handleVaultExport}
          onMemberPublicKeyEnvelopeInputChange={(userId, value) =>
            setMemberPublicKeyEnvelopeInputs((current) => ({ ...current, [userId]: value }))
          }
          onMemberRemove={handleMemberRemove}
          onMemberRoleChange={setMemberRole}
          onMemberRoleEditChange={(userId, role) => setMemberRoleEdits((current) => ({ ...current, [userId]: role }))}
          onMemberRecipientLookupRequest={handleMemberRecipientLookupRequest}
          onMemberSave={handleMemberAdd}
          onMemberUserIdChange={setMemberUserId}
          onRenameVault={handleVaultRename}
          onRenameVaultDescriptionChange={setRenameVaultDescription}
          onRenameVaultNameChange={setRenameVaultName}
          onRetryCreateVault={() => runVaultCreate(pendingVaultCreateRef.current)}
          onRetryRotation={() => runVaultRotation(pendingRotationRef.current)}
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
          onToggleReveal={handleEntryRevealToggle}
          onUpdateMemberRole={handleMemberRoleUpdate}
          renameVaultDescription={renameVaultDescription}
          renameVaultName={renameVaultName}
          rotationPrompt={rotationPrompt}
          selectedEntry={selectedEntry}
          selectedVault={selectedVault}
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
          title="Workspace active"
          description="Unlocked for this browser session."
          statusLabel="Unlocked"
          statusVariant="secondary"
          testId="password-manager-state-unlocked"
          actions={
            <Button variant="outline" onClick={onLock}>
              <Lock className="mr-2 size-4" />
              Lock now
            </Button>
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
  currentPasswordManagerUserId,
  deferredEntryFilter,
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
  memberPublicKeyEnvelopeInputs,
  memberRecipients,
  memberRecipientsPending,
  memberRole,
  memberRoleEdits,
  memberUserId,
  members,
  membersPending,
  organisationUsers,
  onCopyPassword,
  onCreateVault,
  onCreateVaultDescriptionChange,
  onCreateVaultNameChange,
  onDeleteEntry,
  onDeleteVault,
  onEntryFilterChange,
  onEntryNotesChange,
  onEntryPasswordChange,
  onEntrySave,
  onEntryTitleChange,
  onEntryUrlChange,
  onEntryUsernameChange,
  onExportVault,
  onMemberPublicKeyEnvelopeInputChange,
  onMemberRemove,
  onMemberRecipientLookupRequest,
  onMemberRoleChange,
  onMemberRoleEditChange,
  onMemberSave,
  onMemberUserIdChange,
  onRenameVault,
  onRenameVaultDescriptionChange,
  onRenameVaultNameChange,
  onRetryCreateVault,
  onRetryRotation,
  onSelectEntry,
  onSelectVault,
  onStartCreateEntry,
  onStartEditEntry,
  onToggleReveal,
  onUpdateMemberRole,
  renameVaultDescription,
  renameVaultName,
  rotationPrompt,
  selectedEntry,
  selectedVault,
  vaults,
  vaultsPending,
  workspaceError,
  workspacePending,
  workspaceState,
}: {
  createVaultDescription: string
  createVaultName: string
  currentPasswordManagerUserId: string | null
  deferredEntryFilter: string
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
  memberPublicKeyEnvelopeInputs: Record<string, string>
  memberRecipients: Record<string, MemberRecipientRecord>
  memberRecipientsPending: boolean
  memberRole: (typeof PASSWORD_MANAGER_MEMBER_ROLES)[number]
  memberRoleEdits: Record<string, string>
  memberUserId: string
  members: MemberRecord[]
  membersPending: boolean
  organisationUsers: PasswordManagerOrganisationUser[]
  onCopyPassword: (entry: PasswordManagerEntrySummary) => Promise<void>
  onCreateVault: () => Promise<void>
  onCreateVaultDescriptionChange: (value: string) => void
  onCreateVaultNameChange: (value: string) => void
  onDeleteEntry: () => Promise<void>
  onDeleteVault: () => Promise<void>
  onEntryFilterChange: (value: string) => void
  onEntryNotesChange: (value: string) => void
  onEntryPasswordChange: (value: string) => void
  onEntrySave: () => Promise<void>
  onEntryTitleChange: (value: string) => void
  onEntryUrlChange: (value: string) => void
  onEntryUsernameChange: (value: string) => void
  onExportVault: () => Promise<void>
  onMemberPublicKeyEnvelopeInputChange: (userId: string, value: string) => void
  onMemberRemove: (member: MemberRecord) => Promise<void>
  onMemberRecipientLookupRequest: () => void
  onMemberRoleChange: (role: (typeof PASSWORD_MANAGER_MEMBER_ROLES)[number]) => void
  onMemberRoleEditChange: (userId: string, role: string) => void
  onMemberSave: () => Promise<void>
  onMemberUserIdChange: (value: string) => void
  onRenameVault: () => Promise<void>
  onRenameVaultDescriptionChange: (value: string) => void
  onRenameVaultNameChange: (value: string) => void
  onRetryCreateVault: () => Promise<void>
  onRetryRotation: () => Promise<void>
  onSelectEntry: (entryId: string | null) => void
  onSelectVault: (vaultId: string) => void
  onStartCreateEntry: () => void
  onStartEditEntry: (entry: PasswordManagerEntrySummary) => void
  onToggleReveal: (entry: PasswordManagerEntrySummary) => Promise<void>
  onUpdateMemberRole: (member: MemberRecord) => Promise<void>
  renameVaultDescription: string
  renameVaultName: string
  rotationPrompt: string | null
  selectedEntry: PasswordManagerEntrySummary | null
  selectedVault: PasswordManagerVaultSummary | null
  vaults: PasswordManagerVaultSummary[]
  vaultsPending: boolean
  workspaceError: string | null
  workspacePending: boolean
  workspaceState: PasswordManagerWorkspaceState
}) {
  const [memberSelectorOpen, setMemberSelectorOpen] = useState(false)
  const [createVaultDialogOpen, setCreateVaultDialogOpen] = useState(false)
  const memberIds = new Set(members.map((member) => member.user_id))
  const selectedOrganisationUser = organisationUsers.find((user) => user.id === memberUserId) ?? null
  const selectedRecipient = memberUserId ? memberRecipients[memberUserId] : undefined
  const selectedMemberLabel = selectedOrganisationUser
    ? `${selectedOrganisationUser.name || selectedOrganisationUser.email} (${selectedOrganisationUser.email})`
    : 'Select user'

  async function handleCreateVaultFromDialog() {
    await onCreateVault()
    if (createVaultName.trim()) {
      setCreateVaultDialogOpen(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="password-manager-workspace">
      {workspaceError ? (
        <Alert variant={workspaceState.view === 'object-unavailable' ? 'destructive' : 'default'}>
          <AlertCircle className="size-4" />
          <AlertTitle>
            {workspaceState.view === 'object-unavailable' ? 'Object unavailable' : 'Workspace status'}
          </AlertTitle>
          <AlertDescription>{workspaceError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-xs md:flex-row md:items-end md:justify-between">
        <div className="grid gap-2 md:min-w-80">
          <Label htmlFor="password-manager-vault-selector">Vault</Label>
          <Select value={selectedVault?.id ?? ''} onValueChange={onSelectVault} disabled={vaultsPending || vaults.length === 0}>
            <SelectTrigger
              id="password-manager-vault-selector"
              className="w-full"
              data-testid={selectedVault ? `password-manager-vault-${selectedVault.id}` : 'password-manager-vault-selector'}
            >
              <SelectValue placeholder={vaultsPending ? 'Loading vaults...' : 'Select a vault'} />
            </SelectTrigger>
            <SelectContent>
              {vaults.map((vault) => (
                <SelectItem key={vault.id} value={vault.id}>
                  {vault.metadata.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedVault ? (
            <>
              <Badge variant="secondary">Key epoch {selectedVault.currentKeyEpoch}</Badge>
              <Badge variant="outline">{selectedVault.role}</Badge>
            </>
          ) : null}
          <Button variant="outline" onClick={() => setCreateVaultDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            Create vault
          </Button>
        </div>
      </div>

      <Dialog open={createVaultDialogOpen} onOpenChange={setCreateVaultDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create vault</DialogTitle>
            <DialogDescription>Vault metadata is encrypted locally before it leaves the browser.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => void onRetryCreateVault()} disabled={workspacePending}>
              Retry same request
            </Button>
            <Button onClick={() => void handleCreateVaultFromDialog()} disabled={workspacePending}>
              {workspacePending ? 'Saving...' : 'Create encrypted vault'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="passwords" className="gap-4">
        <TabsList>
          <TabsTrigger value="passwords">
            <KeyRound className="size-4" />
            Passwords
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="size-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="passwords" className="space-y-4">
          <Card className="border-border/60 shadow-xs">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Passwords</CardTitle>
                  <CardDescription>
                    {selectedVault
                      ? `Showing entries in ${selectedVault.metadata.name}.`
                      : 'Select or create a vault to view saved passwords.'}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void onExportVault()} disabled={!selectedVault || workspacePending}>
                    <Download className="mr-2 size-4" />
                    Export vault
                  </Button>
                  <Button variant="outline" onClick={onStartCreateEntry} disabled={!selectedVault || workspacePending}>
                    <Plus className="mr-2 size-4" />
                    New entry
                  </Button>
                </div>
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
              {entriesPending ? <p className="text-sm text-muted-foreground">Loading encrypted entries...</p> : null}
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
                      className={`rounded-xl border px-4 py-3 ${
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
                        <Button variant="outline" size="sm" onClick={() => void onToggleReveal(entry)}>
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
                        <p className="mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 font-mono text-sm">
                          {entry.payload.password}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-border/60 p-4">
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
                        {workspacePending ? 'Saving...' : editingEntryId ? 'Save encrypted entry' : 'Create encrypted entry'}
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
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
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
                <CardDescription>Vault settings are available after a vault is selected.</CardDescription>
              </CardHeader>
            </Card>
          )}

          <Card className="border-border/60 shadow-xs">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Members</CardTitle>
                  <CardDescription>
                    Share and revoke access with wrapped vault keys only. Public-key envelopes stay in browser memory for active sessions.
                  </CardDescription>
                </div>
                {selectedVault ? <Badge variant="outline">Vault role: {selectedVault.role}</Badge> : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {rotationPrompt ? (
                <Alert>
                  <RotateCcw className="size-4" />
                  <AlertTitle>Key rotation recommended</AlertTitle>
                  <AlertDescription>{rotationPrompt}</AlertDescription>
                </Alert>
              ) : null}
              {membersPending ? <p className="text-sm text-muted-foreground">Loading wrapped member records...</p> : null}
              {!membersPending && selectedVault && members.length === 0 ? (
                <p className="text-sm text-muted-foreground">This vault has no active members.</p>
              ) : null}
              <div className="space-y-3">
                {members.map((member) => (
                  <div
                    key={member.user_id}
                    className="rounded-xl border border-border/60 p-4"
                    data-testid={`password-manager-member-${member.user_id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{member.user_id}</p>
                        <p className="text-sm text-muted-foreground">Wrapped key epoch {member.key_epoch}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Select
                          value={memberRoleEdits[member.user_id] ?? member.role}
                          onValueChange={(value) => onMemberRoleEditChange(member.user_id, value)}
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue placeholder="Role" />
                          </SelectTrigger>
                          <SelectContent>
                            {PASSWORD_MANAGER_MEMBER_ROLES.map((role) => (
                              <SelectItem key={role} value={role}>
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant="outline" size="sm" onClick={() => void onUpdateMemberRole(member)} disabled={!selectedVault || workspacePending}>
                          <Pencil className="mr-2 size-4" />
                          Save role
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => void onMemberRemove(member)} disabled={!selectedVault || workspacePending}>
                          <Trash2 className="mr-2 size-4" />
                          Remove
                        </Button>
                      </div>
                    </div>
                    {member.user_id !== '' && member.user_id !== ' ' ? (
                      <div className="mt-3 grid gap-2">
                        <Label htmlFor={`password-manager-member-envelope-${member.user_id}`}>
                          Public-key envelope for future rotations
                        </Label>
                        <Textarea
                          id={`password-manager-member-envelope-${member.user_id}`}
                          value={memberPublicKeyEnvelopeInputs[member.user_id] ?? ''}
                          onChange={(event) => onMemberPublicKeyEnvelopeInputChange(member.user_id, event.target.value)}
                          placeholder={
                            member.user_id === currentPasswordManagerUserId
                              ? 'Current session key is already available locally.'
                              : '{"version":1,"algorithm":"rsa-oaep-256","public_key_spki_b64":"..."}'
                          }
                          disabled={member.user_id === currentPasswordManagerUserId}
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {selectedVault ? (
                <>
                  <Separator />
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>Organisation user</Label>
                      <Popover
                        open={memberSelectorOpen}
                        onOpenChange={(open) => {
                          setMemberSelectorOpen(open)
                          if (open) {
                            onMemberRecipientLookupRequest()
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 justify-between"
                            disabled={workspacePending || memberRecipientsPending || !canManageVaultRole(selectedVault.role)}
                            data-testid="password-manager-member-user-selector"
                          >
                            <span className="truncate">{memberRecipientsPending ? 'Loading users...' : selectedMemberLabel}</span>
                            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[360px] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Search organisation users..." />
                            <CommandList>
                              <CommandEmpty>No organisation users found.</CommandEmpty>
                              <CommandGroup>
                                {organisationUsers.map((user) => {
                                  const recipient = memberRecipients[user.id]
                                  const alreadyMember = recipient ? memberIds.has(recipient.user_id) : false
                                  const ready = Boolean(recipient?.setup_configured && recipient.public_key_envelope && !alreadyMember)
                                  const status = alreadyMember
                                    ? 'Already a member'
                                    : recipient?.setup_configured
                                      ? 'Ready'
                                      : 'Password Manager not set up'
                                  return (
                                    <CommandItem
                                      key={user.id}
                                      value={`${user.name ?? ''} ${user.email}`}
                                      disabled={!ready}
                                      onSelect={() => {
                                        onMemberUserIdChange(user.id)
                                        setMemberSelectorOpen(false)
                                      }}
                                      data-testid={`password-manager-member-user-option-${user.id}`}
                                    >
                                      <div className="min-w-0">
                                        <div className="truncate font-medium">{user.name || user.email}</div>
                                        <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                                      </div>
                                      <Badge variant={ready ? 'secondary' : 'outline'} className="ml-auto shrink-0">
                                        {status}
                                      </Badge>
                                      {memberUserId === user.id ? <Check className="size-4" /> : null}
                                    </CommandItem>
                                  )
                                })}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {selectedRecipient && !selectedRecipient.setup_configured ? (
                        <p className="text-xs text-muted-foreground">This user must launch and set up Password Manager before receiving a vault key.</p>
                      ) : null}
                    </div>
                    <div className="grid gap-2">
                      <Label>Role</Label>
                      <Select value={memberRole} onValueChange={(value) => onMemberRoleChange(value as (typeof PASSWORD_MANAGER_MEMBER_ROLES)[number])}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Role" />
                        </SelectTrigger>
                        <SelectContent>
                          {PASSWORD_MANAGER_MEMBER_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void onMemberSave()}
                      disabled={
                        workspacePending ||
                        memberRecipientsPending ||
                        !selectedVault ||
                        !selectedRecipient?.setup_configured ||
                        !selectedRecipient.public_key_envelope
                      }
                    >
                      <Plus className="mr-2 size-4" />
                      Add member
                    </Button>
                    <Button variant="outline" onClick={() => void onRetryRotation()} disabled={workspacePending || !selectedVault}>
                      <RotateCcw className="mr-2 size-4" />
                      Rotate vault key
                    </Button>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
