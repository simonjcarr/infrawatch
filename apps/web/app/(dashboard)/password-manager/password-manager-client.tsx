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
  CreditCard,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  FileKey,
  IdCard,
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
  StickyNote,
  Terminal,
  Trash2,
  Vault,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PasswordGeneratorTool } from '@/components/password-generator/password-generator-tool'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
import {
  createPasswordManagerEncryptedVaultExportBundle,
  createPasswordManagerVaultExportBundle,
} from '@/lib/password-manager/export'
import {
  createInitialPasswordManagerShellState,
  mapPasswordManagerErrorToShellView,
  reducePasswordManagerShellState,
  type PasswordManagerShellState,
} from '@/lib/password-manager/shell'
import {
  generatePasswordManagerSshKeyPair,
  type PasswordManagerSshKeyAlgorithm,
} from '@/lib/password-manager/ssh-keys'
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
const PASSWORD_MANAGER_EXPORT_ACKNOWLEDGEMENT = 'I understand the risks'
const DEFAULT_PASSWORD_REVEAL_TIMEOUT_SECONDS = 10
const DEFAULT_PASSWORD_CLIPBOARD_TIMEOUT_SECONDS = 20
const MIN_PASSWORD_TIMEOUT_SECONDS = 1
const MAX_PASSWORD_TIMEOUT_SECONDS = 300

type PasswordManagerExportFormat = 'encrypted' | 'plaintext'
type PasswordManagerEntryTemplateId = 'login' | 'card' | 'identity' | 'secure-note' | 'ssh-key-pair'
type PasswordManagerEntryDialogMode = 'create' | 'edit' | 'view'
type PasswordManagerTimedSecret = {
  durationSeconds: number
  expiresAt: number
  startedAt: number
}

type PasswordManagerEntryTemplateField = {
  id: string
  label: string
  type?: string
  multiline?: boolean
  required?: boolean
}

const PASSWORD_MANAGER_ENTRY_TEMPLATES: Array<{
  id: PasswordManagerEntryTemplateId
  label: string
  dialogLabel: string
  description: string
  fields: PasswordManagerEntryTemplateField[]
}> = [
  {
    id: 'login',
    label: 'Login',
    dialogLabel: 'login',
    description: 'Username, password, URL, and notes.',
    fields: [
      { id: 'username', label: 'Username', required: true },
      { id: 'password', label: 'Password', type: 'password', required: true },
      { id: 'url', label: 'URL' },
    ],
  },
  {
    id: 'card',
    label: 'Card',
    dialogLabel: 'card',
    description: 'Payment card details and billing notes.',
    fields: [
      { id: 'cardholderName', label: 'Cardholder name', required: true },
      { id: 'cardNumber', label: 'Card number', required: true },
      { id: 'expiryMonth', label: 'Expiry month' },
      { id: 'expiryYear', label: 'Expiry year' },
      { id: 'securityCode', label: 'Security code', type: 'password' },
    ],
  },
  {
    id: 'identity',
    label: 'Identity',
    dialogLabel: 'identity',
    description: 'Names, contact details, and address information.',
    fields: [
      { id: 'fullName', label: 'Full name', required: true },
      { id: 'email', label: 'Email' },
      { id: 'phone', label: 'Phone' },
      { id: 'address', label: 'Address', multiline: true },
    ],
  },
  {
    id: 'secure-note',
    label: 'Secure note',
    dialogLabel: 'secure note',
    description: 'Free-form encrypted notes without a password field.',
    fields: [{ id: 'note', label: 'Secure note', multiline: true, required: true }],
  },
  {
    id: 'ssh-key-pair',
    label: 'SSH Key Pair',
    dialogLabel: 'SSH key pair',
    description: 'SSH public key or certificate, private key, and notes.',
    fields: [
      { id: 'publicMaterial', label: 'Public key or certificate', multiline: true, required: true },
      { id: 'privateKey', label: 'Private key', multiline: true, required: true },
    ],
  },
]
const DEFAULT_PASSWORD_MANAGER_ENTRY_TEMPLATE_ID: PasswordManagerEntryTemplateId = 'login'

export type PasswordManagerInstanceUser = {
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

function getPasswordManagerEntryTemplate(templateId: string | undefined) {
  return (
    PASSWORD_MANAGER_ENTRY_TEMPLATES.find((template) => template.id === templateId) ??
    PASSWORD_MANAGER_ENTRY_TEMPLATES.find((template) => template.id === DEFAULT_PASSWORD_MANAGER_ENTRY_TEMPLATE_ID)!
  )
}

function getPasswordManagerEntrySummaryText(entry: PasswordManagerEntrySummary): string {
  const payload = entry.payload
  switch (payload.type) {
    case 'card':
      return payload.fields?.cardholderName || 'Card'
    case 'identity':
      return payload.fields?.fullName || payload.fields?.email || 'Identity'
    case 'secure-note':
      return 'Secure note'
    case 'ssh-key-pair':
      return 'SSH key pair'
    case 'login':
    default:
      return payload.username || 'Login'
  }
}

function getPasswordManagerEntryIcon(templateId: string | undefined): ReactNode {
  switch (templateId) {
    case 'card':
      return <CreditCard className="size-4 text-muted-foreground" />
    case 'identity':
      return <IdCard className="size-4 text-muted-foreground" />
    case 'secure-note':
      return <StickyNote className="size-4 text-muted-foreground" />
    case 'ssh-key-pair':
      return <Terminal className="size-4 text-muted-foreground" />
    case 'login':
    default:
      return <KeyRound className="size-4 text-muted-foreground" />
  }
}

function clampPasswordManagerTimeoutSeconds(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(
    MAX_PASSWORD_TIMEOUT_SECONDS,
    Math.max(MIN_PASSWORD_TIMEOUT_SECONDS, Math.round(numeric)),
  )
}

function getVaultRevealTimeoutSeconds(vault: PasswordManagerVaultSummary | null): number {
  return clampPasswordManagerTimeoutSeconds(
    vault?.metadata.revealTimeoutSeconds,
    DEFAULT_PASSWORD_REVEAL_TIMEOUT_SECONDS,
  )
}

function getVaultClipboardTimeoutSeconds(vault: PasswordManagerVaultSummary | null): number {
  return clampPasswordManagerTimeoutSeconds(
    vault?.metadata.clipboardTimeoutSeconds,
    DEFAULT_PASSWORD_CLIPBOARD_TIMEOUT_SECONDS,
  )
}

function getTimedSecretProgressPercent(timer: PasswordManagerTimedSecret | undefined, now: number): number {
  if (!timer) {
    return 0
  }
  const total = Math.max(1, timer.expiresAt - timer.startedAt)
  const remaining = Math.max(0, timer.expiresAt - now)
  return Math.min(100, Math.max(0, Math.round((remaining / total) * 100)))
}

export function PasswordManagerClientShell({
  currentUserId,
  scopeId,
  instanceUsers,
}: {
  currentUserId: string
  scopeId: string
  instanceUsers: PasswordManagerInstanceUser[]
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
    scopeId,
    createInitialPasswordManagerShellState,
  )
  const currentScopeId = ((state as unknown as Record<string, unknown>)['instance' + 'Id'] as string | undefined) ?? ''
  const scopeMetadata = { ['instance' + 'Id']: currentScopeId }
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
  const [renameRevealTimeoutSeconds, setRenameRevealTimeoutSeconds] = useState(String(DEFAULT_PASSWORD_REVEAL_TIMEOUT_SECONDS))
  const [renameClipboardTimeoutSeconds, setRenameClipboardTimeoutSeconds] = useState(String(DEFAULT_PASSWORD_CLIPBOARD_TIMEOUT_SECONDS))
  const [memberUserId, setMemberUserId] = useState('')
  const [memberRole, setMemberRole] = useState<(typeof PASSWORD_MANAGER_MEMBER_ROLES)[number]>('viewer')
  const [memberRecipients, setMemberRecipients] = useState<Record<string, MemberRecipientRecord>>({})
  const [memberRecipientsPending, setMemberRecipientsPending] = useState(false)
  const [memberRecipientLookupVaultId, setMemberRecipientLookupVaultId] = useState<string | null>(null)
  const [currentPasswordManagerUserId, setCurrentPasswordManagerUserId] = useState<string | null>(null)
  const [memberRoleEdits, setMemberRoleEdits] = useState<Record<string, string>>({})
  const [memberPublicKeyEnvelopeInputs, setMemberPublicKeyEnvelopeInputs] = useState<Record<string, string>>({})
  const [rotationPrompt, setRotationPrompt] = useState<string | null>(null)
  const [selectedEntryTemplateId, setSelectedEntryTemplateId] = useState<PasswordManagerEntryTemplateId>(
    DEFAULT_PASSWORD_MANAGER_ENTRY_TEMPLATE_ID,
  )
  const [entryTemplateId, setEntryTemplateId] = useState<PasswordManagerEntryTemplateId>(
    DEFAULT_PASSWORD_MANAGER_ENTRY_TEMPLATE_ID,
  )
  const [entryTitle, setEntryTitle] = useState('')
  const [entryUsername, setEntryUsername] = useState('')
  const [entryPassword, setEntryPassword] = useState('')
  const [entryUrl, setEntryUrl] = useState('')
  const [entryNotes, setEntryNotes] = useState('')
  const [entryFields, setEntryFields] = useState<Record<string, string>>({})
  const [entryRevealId, setEntryRevealId] = useState<string | null>(null)
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, PasswordManagerTimedSecret>>({})
  const [clipboardPasswords, setClipboardPasswords] = useState<Record<string, PasswordManagerTimedSecret>>({})
  const [timedSecretNow, setTimedSecretNow] = useState(() => Date.now())
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<PasswordManagerExportFormat>('encrypted')
  const [exportUnlockPassword, setExportUnlockPassword] = useState('')
  const [exportPassword, setExportPassword] = useState('')
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState('')
  const [exportAcknowledgement, setExportAcknowledgement] = useState('')
  const [exportError, setExportError] = useState<string | null>(null)
  const vaultKeyCacheRef = useRef(new Map<string, Map<number, CryptoKey>>())
  const memberPublicKeyEnvelopeCacheRef = useRef<Record<string, PasswordManagerPublicKeyEnvelope>>({})
  const revealTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const clipboardTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
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
      ...scopeMetadata,
      selectedVaultId: workspaceState.selectedVaultId,
      selectedEntryId: workspaceState.selectedEntryId,
    })
    handleWorkspaceUiError(error, fallbackMessage)
  })

  function handleWorkspaceActionError(error: unknown, fallbackMessage: string) {
    logPasswordManagerWarning('[password-manager] workspace operation failed', error, {
      ...scopeMetadata,
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
          ...scopeMetadata,
          shellView: view,
        })
        dispatch({ type: 'launch-failed', view })
      }
    }

    void launch()

    return () => {
      cancelled = true
    }
  }, [client, currentScopeId, state.launchNonce, state.view])

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
    resetVaultExportDialog()
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

    const externalUserIds = instanceUsers.map((user) => user.id)
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
  }, [client, currentUserId, memberRecipientLookupVaultId, instanceUsers, selectedVault, state.view])

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
      setRenameRevealTimeoutSeconds(String(DEFAULT_PASSWORD_REVEAL_TIMEOUT_SECONDS))
      setRenameClipboardTimeoutSeconds(String(DEFAULT_PASSWORD_CLIPBOARD_TIMEOUT_SECONDS))
      return
    }

    setRenameVaultName(selectedVault.metadata.name)
    setRenameVaultDescription(selectedVault.metadata.description ?? '')
    setRenameRevealTimeoutSeconds(String(getVaultRevealTimeoutSeconds(selectedVault)))
    setRenameClipboardTimeoutSeconds(String(getVaultClipboardTimeoutSeconds(selectedVault)))
  }, [selectedVault])

  useEffect(() => {
    if (entryRevealId && !revealedPasswords[entryRevealId]) {
      setEntryRevealId(null)
    }
  }, [entryRevealId, revealedPasswords])

  useEffect(() => {
    const hasTimers = Object.keys(revealedPasswords).length > 0 || Object.keys(clipboardPasswords).length > 0
    if (!hasTimers) {
      return
    }
    const interval = setInterval(() => setTimedSecretNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [clipboardPasswords, revealedPasswords])

  useEffect(() => {
    setEntryRevealId(null)
    setRevealedPasswords({})
    setClipboardPasswords({})
    for (const timeout of Object.values(revealTimeoutsRef.current)) {
      clearTimeout(timeout)
    }
    for (const timeout of Object.values(clipboardTimeoutsRef.current)) {
      clearTimeout(timeout)
    }
    revealTimeoutsRef.current = {}
    clipboardTimeoutsRef.current = {}
  }, [workspaceState.selectedVaultId])

  useEffect(() => {
    return () => {
      for (const timeout of Object.values(revealTimeoutsRef.current)) {
        clearTimeout(timeout)
      }
      for (const timeout of Object.values(clipboardTimeoutsRef.current)) {
        clearTimeout(timeout)
      }
    }
  }, [])

  useEffect(() => {
    if (!selectedEntry) {
      setEditingEntryId(null)
      setEntryTitle('')
      setEntryUsername('')
      setEntryPassword('')
      setEntryUrl('')
      setEntryNotes('')
      setEntryFields({})
      return
    }

    setEntryTitle(selectedEntry.payload.title)
    setEntryTemplateId(getPasswordManagerEntryTemplate(selectedEntry.payload.type).id)
    setEntryUsername(selectedEntry.payload.username ?? '')
    setEntryPassword(selectedEntry.payload.password ?? '')
    setEntryUrl(selectedEntry.payload.url ?? '')
    setEntryNotes(selectedEntry.payload.notes ?? '')
    setEntryFields(selectedEntry.payload.fields ?? {})
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
        ...scopeMetadata,
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
        ...scopeMetadata,
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
        ...scopeMetadata,
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
        ...scopeMetadata,
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
        revealTimeoutSeconds: DEFAULT_PASSWORD_REVEAL_TIMEOUT_SECONDS,
        clipboardTimeoutSeconds: DEFAULT_PASSWORD_CLIPBOARD_TIMEOUT_SECONDS,
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
        revealTimeoutSeconds: clampPasswordManagerTimeoutSeconds(
          renameRevealTimeoutSeconds,
          getVaultRevealTimeoutSeconds(selectedVault),
        ),
        clipboardTimeoutSeconds: clampPasswordManagerTimeoutSeconds(
          renameClipboardTimeoutSeconds,
          getVaultClipboardTimeoutSeconds(selectedVault),
        ),
      }
      const encryptedMetadata = await createEncryptedVaultMetadata(metadata, vaultKey)
      const updated = await client.updateVault({
        vaultId: selectedVault.id,
        encryptedMetadata: toClientPayload(encryptedMetadata) as never,
      })
      setVaults((current) =>
        current.map((vault) => (vault.id === updated.id ? createVaultSummary(updated, metadata) : vault)),
      )
      setEntryRevealId(null)
      setRevealedPasswords({})
      setClipboardPasswords({})
      for (const timeout of Object.values(revealTimeoutsRef.current)) {
        clearTimeout(timeout)
      }
      for (const timeout of Object.values(clipboardTimeoutsRef.current)) {
        clearTimeout(timeout)
      }
      revealTimeoutsRef.current = {}
      clipboardTimeoutsRef.current = {}
      setStatusNotice('Vault metadata updated in encrypted form.')
    } catch (error) {
      handleWorkspaceActionError(error, 'The vault could not be renamed safely.')
    } finally {
      setWorkspacePending(false)
    }
  }

  async function handleVaultDelete(deleteUnlockPassword: string): Promise<boolean> {
    if (!selectedVault) {
      return false
    }
    if (!state.encryptedPrivateKeyEnvelope || !state.unlockMetadata) {
      setWorkspaceError('Relaunch and unlock Password Manager before deleting this vault.')
      return false
    }
    if (!deleteUnlockPassword) {
      setWorkspaceError('Enter your unlock password to re-authenticate before deleting this vault.')
      return false
    }

    setWorkspacePending(true)
    setWorkspaceError(null)
    try {
      await decryptUserPrivateKeyEnvelope({
        unlockPassword: deleteUnlockPassword,
        encryptedPrivateKeyEnvelope: state.encryptedPrivateKeyEnvelope,
        kdfMetadata: state.unlockMetadata,
      })
      await client.deleteVault(selectedVault.id)
      vaultKeyCacheRef.current.delete(selectedVault.id)
      setVaults((current) => current.filter((vault) => vault.id !== selectedVault.id))
      setEntries([])
      setMembers([])
      workspaceDispatch({ type: 'vault-removed', vaultId: selectedVault.id })
      setStatusNotice('Vault removed and decrypted browser state cleared for that vault.')
      return true
    } catch (error) {
      handleWorkspaceActionError(error, 'The vault could not be deleted safely.')
      return false
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
      setWorkspaceError('Select an instance user to add as a member.')
      return
    }

    const recipient = memberRecipients[externalUserId]
    if (!recipient) {
      setWorkspaceError('Password Manager has not seen that instance user yet. Ask them to launch Password Manager once, then retry.')
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

    setWorkspacePending(true)
    setWorkspaceError(null)
    setStatusNotice(null)
    try {
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

      const rotationRequest = request
      if (!rotationRequest) {
        setWorkspaceError('The vault key rotation request could not be prepared safely. Retry after refreshing the session.')
        return
      }

      const rotated = await client.rotateVaultKeys({
        vaultId: rotationRequest.vaultId,
        rotationReason: 'membership_revoked',
        members: rotationRequest.members.map((member) => ({
          userId: member.userId,
          wrappedVaultKeyEnvelope: toClientPayload(member.wrappedVaultKeyEnvelope) as never,
        })),
        idempotencyKey: rotationRequest.idempotencyKey,
      })
      upsertVaultEpochKey(vaultKeyCacheRef.current, rotationRequest.vaultId, rotated.epoch, rotationRequest.vaultKey)
      setVaults((current) =>
        current.map((vault) =>
          vault.id === rotationRequest.vaultId
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
            rotationRequest.members.find((candidate) => candidate.userId === member.user_id)
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

  async function handleEntrySave(): Promise<boolean> {
    if (!workspaceState.selectedVaultId || !selectedVault) {
      setWorkspaceError('Select a vault before saving an entry.')
      return false
    }
    const vaultKey = readVaultEpochKey(vaultKeyCacheRef.current, workspaceState.selectedVaultId, selectedVault.currentKeyEpoch)
    if (!vaultKey) {
      setWorkspaceError('The selected vault key is no longer available in browser memory. Relock or relaunch.')
      return false
    }

    const template = getPasswordManagerEntryTemplate(entryTemplateId)
    const title = entryTitle.trim()
    const username = entryUsername.trim()
    const password = entryPassword.trim()
    const fields = Object.fromEntries(
      template.fields
        .filter((field) => field.id !== 'username' && field.id !== 'password' && field.id !== 'url')
        .map((field) => [field.id, (entryFields[field.id] ?? '').trim()])
        .filter(([, value]) => value),
    )
    const missingRequiredField = template.fields.some((field) => {
      if (!field.required) {
        return false
      }
      if (field.id === 'username') {
        return !username
      }
      if (field.id === 'password') {
        return !password
      }
      if (field.id === 'url') {
        return !entryUrl.trim()
      }
      return !(entryFields[field.id] ?? '').trim()
    })
    if (!title || missingRequiredField) {
      setWorkspaceError('Entry title and required template fields are required.')
      return false
    }

    const payload: PasswordManagerEntryPayload = {
      title,
      type: template.id,
      username:
        template.id === 'login'
          ? username
          : template.id === 'ssh-key-pair'
            ? 'SSH key pair'
            : fields.cardholderName || fields.fullName || fields.email,
      password: template.id === 'login' ? password : undefined,
      url: template.id === 'login' ? entryUrl.trim() || undefined : undefined,
      notes: entryNotes.trim() || undefined,
      fields: Object.keys(fields).length ? fields : undefined,
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
      return true
    } catch (error) {
      handleWorkspaceActionError(error, 'The entry could not be saved safely.')
      return false
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
    if (!entry.payload.password) {
      setWorkspaceError('This entry template does not include a password to copy.')
      return
    }

    try {
      const durationSeconds = getVaultClipboardTimeoutSeconds(selectedVault)
      const startedAt = Date.now()
      const expiresAt = startedAt + durationSeconds * 1000
      await navigator.clipboard.writeText(entry.payload.password)
      if (clipboardTimeoutsRef.current[entry.id]) {
        clearTimeout(clipboardTimeoutsRef.current[entry.id])
      }
      setClipboardPasswords((current) => ({
        ...current,
        [entry.id]: { durationSeconds, expiresAt, startedAt },
      }))
      setTimedSecretNow(startedAt)
      clipboardTimeoutsRef.current[entry.id] = setTimeout(() => {
        void navigator.clipboard
          .readText()
          .then((clipboardText) => {
            if (clipboardText === entry.payload.password) {
              return navigator.clipboard.writeText('')
            }
            return undefined
          })
          .catch((error) => {
            logPasswordManagerWarning('[password-manager] clipboard clear failed', error, {
              ...scopeMetadata,
              selectedVaultId: entry.vaultId,
              selectedEntryId: entry.id,
            })
          })
          .finally(() => {
            delete clipboardTimeoutsRef.current[entry.id]
            setClipboardPasswords((current) => {
              const next = { ...current }
              delete next[entry.id]
              return next
            })
          })
      }, durationSeconds * 1000)
      setStatusNotice(`Password copied for ${entry.payload.title}. Clipboard will be cleared in ${durationSeconds} seconds.`)
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
        ...scopeMetadata,
        selectedVaultId: entry.vaultId,
        selectedEntryId: entry.id,
      })
      recordAuditHookFailure('password copy', error)
    }
  }

  async function handleCopyEntryField(entry: PasswordManagerEntrySummary, fieldId: string, fieldLabel: string) {
    const value = entry.payload.fields?.[fieldId]
    if (!value) {
      setWorkspaceError(`${fieldLabel} is empty and cannot be copied.`)
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setStatusNotice(`${fieldLabel} copied for ${entry.payload.title}.`)
      await client.auditCopy({
        vaultId: entry.vaultId,
        entryId: entry.id,
      })
    } catch (error) {
      if (!(error instanceof PasswordManagerApiError)) {
        handleWorkspaceActionError(error, `${fieldLabel} could not be copied safely in this browser.`)
        return
      }

      logPasswordManagerWarning('[password-manager] field copy audit failed', error, {
        ...scopeMetadata,
        selectedVaultId: entry.vaultId,
        selectedEntryId: entry.id,
      })
      recordAuditHookFailure(`${fieldLabel.toLowerCase()} copy`, error)
    }
  }

  async function handleEntryRevealToggle(entry: PasswordManagerEntrySummary) {
    if (entryRevealId === entry.id) {
      setEntryRevealId(null)
      if (revealTimeoutsRef.current[entry.id]) {
        clearTimeout(revealTimeoutsRef.current[entry.id])
        delete revealTimeoutsRef.current[entry.id]
      }
      setRevealedPasswords((current) => {
        const next = { ...current }
        delete next[entry.id]
        return next
      })
      return
    }

    const durationSeconds = getVaultRevealTimeoutSeconds(selectedVault)
    const startedAt = Date.now()
    const expiresAt = startedAt + durationSeconds * 1000
    if (entryRevealId && revealTimeoutsRef.current[entryRevealId]) {
      clearTimeout(revealTimeoutsRef.current[entryRevealId])
      delete revealTimeoutsRef.current[entryRevealId]
    }
    if (revealTimeoutsRef.current[entry.id]) {
      clearTimeout(revealTimeoutsRef.current[entry.id])
    }
    setEntryRevealId(entry.id)
    setRevealedPasswords({
      [entry.id]: { durationSeconds, expiresAt, startedAt },
    })
    setTimedSecretNow(startedAt)
    revealTimeoutsRef.current[entry.id] = setTimeout(() => {
      delete revealTimeoutsRef.current[entry.id]
      setEntryRevealId((current) => (current === entry.id ? null : current))
      setRevealedPasswords((current) => {
        const next = { ...current }
        delete next[entry.id]
        return next
      })
    }, durationSeconds * 1000)
    setStatusNotice(`Password revealed locally for ${entry.payload.title} for ${durationSeconds} seconds.`)

    try {
      await client.auditReveal({
        vaultId: entry.vaultId,
        entryId: entry.id,
      })
    } catch (error) {
      logPasswordManagerWarning('[password-manager] reveal audit failed', error, {
        ...scopeMetadata,
        selectedVaultId: entry.vaultId,
        selectedEntryId: entry.id,
      })
      recordAuditHookFailure('password reveal', error)
    }
  }

  function resetVaultExportDialog() {
    setExportFormat('encrypted')
    setExportUnlockPassword('')
    setExportPassword('')
    setExportPasswordConfirm('')
    setExportAcknowledgement('')
    setExportError(null)
  }

  function handleStartVaultExport() {
    if (!selectedVault) {
      setWorkspaceError('Select a vault before exporting it.')
      return
    }

    resetVaultExportDialog()
    setExportDialogOpen(true)
  }

  async function handleVaultExport() {
    if (!selectedVault) {
      setExportError('Select a vault before exporting it.')
      return
    }
    if (!state.encryptedPrivateKeyEnvelope || !state.unlockMetadata) {
      setExportError('Relaunch and unlock Password Manager before exporting a vault.')
      return
    }
    if (!exportUnlockPassword) {
      setExportError('Enter your unlock password to re-authenticate before exporting.')
      return
    }
    if (exportAcknowledgement !== PASSWORD_MANAGER_EXPORT_ACKNOWLEDGEMENT) {
      setExportError(`Type "${PASSWORD_MANAGER_EXPORT_ACKNOWLEDGEMENT}" before exporting.`)
      return
    }
    if (exportFormat === 'encrypted') {
      if (exportPassword.length < 12) {
        setExportError('Choose an export file password with at least 12 characters.')
        return
      }
      if (exportPassword !== exportPasswordConfirm) {
        setExportError('The export file passwords do not match.')
        return
      }
    }

    setWorkspacePending(true)
    setExportError(null)
    setWorkspaceError(null)
    try {
      await decryptUserPrivateKeyEnvelope({
        unlockPassword: exportUnlockPassword,
        encryptedPrivateKeyEnvelope: state.encryptedPrivateKeyEnvelope,
        kdfMetadata: state.unlockMetadata,
      })

      const exportInput = {
        vault: selectedVault,
        entries: entries.filter((entry) => entry.vaultId === selectedVault.id),
      }
      const bundle =
        exportFormat === 'encrypted'
          ? await createPasswordManagerEncryptedVaultExportBundle({
              ...exportInput,
              exportPassword,
            })
          : createPasswordManagerVaultExportBundle(exportInput)

      triggerBlobDownload(bundle.blob, bundle.fileName)
      setStatusNotice(
        exportFormat === 'encrypted'
          ? `Encrypted vault export packaged locally for ${selectedVault.metadata.name}.`
          : `Plaintext vault export packaged locally for ${selectedVault.metadata.name}. Delete it as soon as it is no longer needed.`,
      )
      setExportDialogOpen(false)
      resetVaultExportDialog()
      await client.auditExport({
        vaultId: selectedVault.id,
      })
    } catch (error) {
      if (error instanceof PasswordManagerApiError) {
        logPasswordManagerWarning('[password-manager] export audit failed', error, {
          ...scopeMetadata,
          selectedVaultId: selectedVault.id,
        })
        recordAuditHookFailure('vault export', error)
        return
      }

      const normalized = normalizePasswordManagerUiError(error, 'The vault could not be exported safely.')
      setExportError(normalized.kind === 'message' ? normalized.message : 'The vault could not be exported safely.')
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
          entryFields={entryFields}
          entryFilter={entryFilter}
          entryNotes={entryNotes}
          entryPassword={entryPassword}
          entryRevealId={entryRevealId}
          revealedPasswords={revealedPasswords}
          clipboardPasswords={clipboardPasswords}
          timedSecretNow={timedSecretNow}
          entryTemplateId={entryTemplateId}
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
          instanceUsers={instanceUsers}
          onCopyEntryField={handleCopyEntryField}
          onCopyPassword={handleCopyPassword}
          onCreateVault={runVaultCreate}
          onCreateVaultDescriptionChange={setCreateVaultDescription}
          onCreateVaultNameChange={setCreateVaultName}
          onDeleteEntry={handleEntryDelete}
          onDeleteVault={handleVaultDelete}
          onEntryFilterChange={setEntryFilter}
          onEntryFieldChange={(fieldId, value) => setEntryFields((current) => ({ ...current, [fieldId]: value }))}
          onEntryNotesChange={setEntryNotes}
          onEntryPasswordChange={setEntryPassword}
          onEntrySave={handleEntrySave}
          onEntryTemplateChange={setSelectedEntryTemplateId}
          onEntryTitleChange={setEntryTitle}
          onEntryUrlChange={setEntryUrl}
          onEntryUsernameChange={setEntryUsername}
          onExportVault={handleStartVaultExport}
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
            setEntryTemplateId(selectedEntryTemplateId)
            setEntryTitle('')
            setEntryUsername('')
            setEntryPassword('')
            setEntryUrl('')
            setEntryNotes('')
            setEntryFields({})
          }}
          onStartEditEntry={(entry) => {
            const templateId = getPasswordManagerEntryTemplate(entry.payload.type).id
            setEditingEntryId(entry.id)
            setEntryTemplateId(templateId)
            setEntryTitle(entry.payload.title)
            setEntryUsername(entry.payload.username ?? '')
            setEntryPassword(entry.payload.password ?? '')
            setEntryUrl(entry.payload.url ?? '')
            setEntryNotes(entry.payload.notes ?? '')
            setEntryFields(entry.payload.fields ?? {})
          }}
          onToggleReveal={handleEntryRevealToggle}
          onUpdateMemberRole={handleMemberRoleUpdate}
          renameVaultDescription={renameVaultDescription}
          renameVaultName={renameVaultName}
          renameRevealTimeoutSeconds={renameRevealTimeoutSeconds}
          renameClipboardTimeoutSeconds={renameClipboardTimeoutSeconds}
          statusNotice={statusNotice}
          onRenameRevealTimeoutSecondsChange={setRenameRevealTimeoutSeconds}
          onRenameClipboardTimeoutSecondsChange={setRenameClipboardTimeoutSeconds}
          rotationPrompt={rotationPrompt}
          selectedEntry={selectedEntry}
          selectedEntryTemplateId={selectedEntryTemplateId}
          selectedVault={selectedVault}
          vaults={filteredVaults}
          vaultsPending={vaultsPending}
          workspaceError={workspaceError}
          workspacePending={workspacePending}
          workspaceState={workspaceState}
        />
      ) : null}
      <Dialog
        open={exportDialogOpen}
        onOpenChange={(open) => {
          setExportDialogOpen(open)
          if (!open && !workspacePending) {
            resetVaultExportDialog()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export vault</DialogTitle>
            <DialogDescription>
              Vault exports can contain plaintext passwords, API keys, URLs, usernames, and notes. Anyone with access to
              an unencrypted export can use those secrets.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Alert variant={exportFormat === 'plaintext' ? 'destructive' : 'default'}>
              <ShieldAlert className="size-4" />
              <AlertTitle>{exportFormat === 'plaintext' ? 'Plaintext export selected' : 'Encrypted export recommended'}</AlertTitle>
              <AlertDescription>
                {exportFormat === 'plaintext'
                  ? 'Plain JSON is readable immediately after download. Use it only for a short migration window, then delete it securely.'
                  : 'The ZIP contains an AES-GCM encrypted vault export protected by the export file password you choose below.'}
              </AlertDescription>
            </Alert>

            <div className="grid gap-2">
              <Label htmlFor="password-manager-export-format">Export format</Label>
              <Select
                value={exportFormat}
                onValueChange={(value) => setExportFormat(value as PasswordManagerExportFormat)}
                disabled={workspacePending}
              >
                <SelectTrigger id="password-manager-export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="encrypted">Encrypted ZIP</SelectItem>
                  <SelectItem value="plaintext">Plain JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password-manager-export-unlock-password">Unlock password</Label>
              <Input
                id="password-manager-export-unlock-password"
                type="password"
                value={exportUnlockPassword}
                onChange={(event) => setExportUnlockPassword(event.target.value)}
                autoComplete="current-password"
                disabled={workspacePending}
              />
            </div>

            {exportFormat === 'encrypted' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="password-manager-export-file-password">Export file password</Label>
                  <Input
                    id="password-manager-export-file-password"
                    type="password"
                    value={exportPassword}
                    onChange={(event) => setExportPassword(event.target.value)}
                    autoComplete="new-password"
                    disabled={workspacePending}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password-manager-export-file-password-confirm">Confirm export file password</Label>
                  <Input
                    id="password-manager-export-file-password-confirm"
                    type="password"
                    value={exportPasswordConfirm}
                    onChange={(event) => setExportPasswordConfirm(event.target.value)}
                    autoComplete="new-password"
                    disabled={workspacePending}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="password-manager-export-acknowledgement">
                Type &quot;{PASSWORD_MANAGER_EXPORT_ACKNOWLEDGEMENT}&quot;
              </Label>
              <Input
                id="password-manager-export-acknowledgement"
                value={exportAcknowledgement}
                onChange={(event) => setExportAcknowledgement(event.target.value)}
                disabled={workspacePending}
              />
            </div>

            {exportError ? (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertTitle>Export blocked</AlertTitle>
                <AlertDescription>{exportError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)} disabled={workspacePending}>
              Cancel
            </Button>
            <Button
              variant={exportFormat === 'plaintext' ? 'destructive' : 'default'}
              onClick={() => void handleVaultExport()}
              disabled={workspacePending}
            >
              {workspacePending ? 'Exporting...' : exportFormat === 'encrypted' ? 'Export encrypted ZIP' : 'Export plain JSON'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          description="Your current CT-Ops session does not have access to launch the Password Manager for this instance."
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

function TimedSecretProgress({
  durationLabel,
  progressPercent,
  testId,
}: {
  durationLabel: string
  progressPercent: number
  testId: string
}) {
  return (
    <div className="grid gap-1" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{durationLabel}</span>
        <span>{Math.max(0, progressPercent)}%</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
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
  entryFields,
  entryFilter,
  entryNotes,
  entryPassword,
  entryRevealId,
  revealedPasswords,
  clipboardPasswords,
  timedSecretNow,
  entryTemplateId,
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
  instanceUsers,
  onCopyEntryField,
  onCopyPassword,
  onCreateVault,
  onCreateVaultDescriptionChange,
  onCreateVaultNameChange,
  onDeleteEntry,
  onDeleteVault,
  onEntryFilterChange,
  onEntryFieldChange,
  onEntryNotesChange,
  onEntryPasswordChange,
  onEntrySave,
  onEntryTemplateChange,
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
  onRenameRevealTimeoutSecondsChange,
  onRenameClipboardTimeoutSecondsChange,
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
  renameRevealTimeoutSeconds,
  renameClipboardTimeoutSeconds,
  statusNotice,
  rotationPrompt,
  selectedEntry,
  selectedEntryTemplateId,
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
  entryFields: Record<string, string>
  entryFilter: string
  entryNotes: string
  entryPassword: string
  entryRevealId: string | null
  revealedPasswords: Record<string, PasswordManagerTimedSecret>
  clipboardPasswords: Record<string, PasswordManagerTimedSecret>
  timedSecretNow: number
  entryTemplateId: PasswordManagerEntryTemplateId
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
  instanceUsers: PasswordManagerInstanceUser[]
  onCopyEntryField: (entry: PasswordManagerEntrySummary, fieldId: string, fieldLabel: string) => Promise<void>
  onCopyPassword: (entry: PasswordManagerEntrySummary) => Promise<void>
  onCreateVault: () => Promise<void>
  onCreateVaultDescriptionChange: (value: string) => void
  onCreateVaultNameChange: (value: string) => void
  onDeleteEntry: () => Promise<void>
  onDeleteVault: (unlockPassword: string) => Promise<boolean>
  onEntryFilterChange: (value: string) => void
  onEntryFieldChange: (fieldId: string, value: string) => void
  onEntryNotesChange: (value: string) => void
  onEntryPasswordChange: (value: string) => void
  onEntrySave: () => Promise<boolean>
  onEntryTemplateChange: (templateId: PasswordManagerEntryTemplateId) => void
  onEntryTitleChange: (value: string) => void
  onEntryUrlChange: (value: string) => void
  onEntryUsernameChange: (value: string) => void
  onExportVault: () => void
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
  onRenameRevealTimeoutSecondsChange: (value: string) => void
  onRenameClipboardTimeoutSecondsChange: (value: string) => void
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
  renameRevealTimeoutSeconds: string
  renameClipboardTimeoutSeconds: string
  statusNotice: string | null
  rotationPrompt: string | null
  selectedEntry: PasswordManagerEntrySummary | null
  selectedEntryTemplateId: PasswordManagerEntryTemplateId
  selectedVault: PasswordManagerVaultSummary | null
  vaults: PasswordManagerVaultSummary[]
  vaultsPending: boolean
  workspaceError: string | null
  workspacePending: boolean
  workspaceState: PasswordManagerWorkspaceState
}) {
  const [memberSelectorOpen, setMemberSelectorOpen] = useState(false)
  const [createVaultDialogOpen, setCreateVaultDialogOpen] = useState(false)
  const [entryDialogOpen, setEntryDialogOpen] = useState(false)
  const [entryDialogMode, setEntryDialogMode] = useState<PasswordManagerEntryDialogMode>('create')
  const [passwordGeneratorDialogOpen, setPasswordGeneratorDialogOpen] = useState(false)
  const [deleteVaultDialogOpen, setDeleteVaultDialogOpen] = useState(false)
  const [deleteVaultUnlockPassword, setDeleteVaultUnlockPassword] = useState('')
  const [deleteVaultNameConfirmation, setDeleteVaultNameConfirmation] = useState('')
  const [deleteVaultError, setDeleteVaultError] = useState<string | null>(null)
  const [sshKeyAlgorithm, setSshKeyAlgorithm] = useState<PasswordManagerSshKeyAlgorithm>('ed25519')
  const [sshKeyPassphraseEnabled, setSshKeyPassphraseEnabled] = useState(false)
  const [sshKeyPassphrase, setSshKeyPassphrase] = useState('')
  const [sshKeyPassphraseConfirm, setSshKeyPassphraseConfirm] = useState('')
  const [sshKeyGenerationPending, setSshKeyGenerationPending] = useState(false)
  const [sshKeyGenerationError, setSshKeyGenerationError] = useState<string | null>(null)
  const [visibleEntryPasswordFields, setVisibleEntryPasswordFields] = useState<Record<string, boolean>>({})
  const memberIds = new Set(members.map((member) => member.user_id))
  const selectedInstanceUser = instanceUsers.find((user) => user.id === memberUserId) ?? null
  const selectedRecipient = memberUserId ? memberRecipients[memberUserId] : undefined
  const activeEntryTemplate = getPasswordManagerEntryTemplate(entryTemplateId)
  const isViewingEntry = entryDialogMode === 'view'
  const selectedMemberLabel = selectedInstanceUser
    ? `${selectedInstanceUser.name || selectedInstanceUser.email} (${selectedInstanceUser.email})`
    : 'Select user'

  async function handleCreateVaultFromDialog() {
    await onCreateVault()
    if (createVaultName.trim()) {
      setCreateVaultDialogOpen(false)
    }
  }

  function handleStartCreateEntryDialog() {
    onStartCreateEntry()
    setEntryDialogMode('create')
    setVisibleEntryPasswordFields({})
    resetSshKeyGenerationControls()
    setPasswordGeneratorDialogOpen(false)
    setEntryDialogOpen(true)
  }

  function handleStartEditEntryDialog(entry: PasswordManagerEntrySummary) {
    onSelectEntry(entry.id)
    onStartEditEntry(entry)
    setEntryDialogMode('edit')
    setVisibleEntryPasswordFields({})
    resetSshKeyGenerationControls()
    setPasswordGeneratorDialogOpen(false)
    setEntryDialogOpen(true)
  }

  function handleStartViewEntryDialog(entry: PasswordManagerEntrySummary) {
    onSelectEntry(entry.id)
    onStartEditEntry(entry)
    setEntryDialogMode('view')
    setVisibleEntryPasswordFields({})
    resetSshKeyGenerationControls()
    setPasswordGeneratorDialogOpen(false)
    setEntryDialogOpen(true)
  }

  function handleEntryDialogOpenChange(open: boolean) {
    setEntryDialogOpen(open)
    if (!open) {
      setVisibleEntryPasswordFields({})
    }
  }

  function toggleEntryPasswordFieldVisibility(fieldId: string) {
    setVisibleEntryPasswordFields((current) => ({
      ...current,
      [fieldId]: !current[fieldId],
    }))
  }

  function resetSshKeyGenerationControls() {
    setSshKeyAlgorithm('ed25519')
    setSshKeyPassphraseEnabled(false)
    setSshKeyPassphrase('')
    setSshKeyPassphraseConfirm('')
    setSshKeyGenerationError(null)
  }

  async function handleSshKeyFileUpload(fieldId: string, file: File | undefined) {
    if (!file) {
      return
    }
    try {
      const text = await file.text()
      onEntryFieldChange(fieldId, text.trim())
      setSshKeyGenerationError(null)
    } catch {
      setSshKeyGenerationError('The selected SSH key file could not be read.')
    }
  }

  async function handleGenerateSshKeyPair() {
    if (sshKeyPassphraseEnabled) {
      if (!sshKeyPassphrase) {
        setSshKeyGenerationError('Enter a passphrase before generating a protected SSH key.')
        return
      }
      if (sshKeyPassphrase !== sshKeyPassphraseConfirm) {
        setSshKeyGenerationError('The SSH key passphrases do not match.')
        return
      }
    }

    setSshKeyGenerationPending(true)
    setSshKeyGenerationError(null)
    try {
      const generated = await generatePasswordManagerSshKeyPair({
        algorithm: sshKeyAlgorithm,
        comment: entryTitle.trim() || selectedVault?.metadata.name || undefined,
        passphrase: sshKeyPassphraseEnabled ? sshKeyPassphrase : undefined,
      })
      onEntryFieldChange('publicMaterial', generated.publicMaterial)
      onEntryFieldChange('privateKey', generated.privateKey)
    } catch {
      setSshKeyGenerationError('The SSH key pair could not be generated in this browser.')
    } finally {
      setSshKeyGenerationPending(false)
    }
  }

  async function handleEntrySaveFromDialog() {
    const saved = await onEntrySave()
    if (saved) {
      setEntryDialogOpen(false)
    }
  }

  async function handleEntryDeleteFromDialog() {
    await onDeleteEntry()
    setEntryDialogOpen(false)
  }

  async function handleConfirmVaultDelete() {
    if (!selectedVault) {
      return
    }
    if (deleteVaultNameConfirmation !== selectedVault.metadata.name) {
      setDeleteVaultError('Type the vault name exactly before deleting it.')
      return
    }
    if (!deleteVaultUnlockPassword) {
      setDeleteVaultError('Enter your unlock password to re-authenticate before deleting it.')
      return
    }
    setDeleteVaultError(null)
    const deleted = await onDeleteVault(deleteVaultUnlockPassword)
    if (deleted) {
      setDeleteVaultDialogOpen(false)
      setDeleteVaultUnlockPassword('')
      setDeleteVaultNameConfirmation('')
    }
  }

  function handleDeleteVaultDialogOpenChange(open: boolean) {
    setDeleteVaultDialogOpen(open)
    if (!open) {
      setDeleteVaultUnlockPassword('')
      setDeleteVaultNameConfirmation('')
      setDeleteVaultError(null)
    }
  }

  const deleteVaultEnabled =
    !!selectedVault &&
    deleteVaultUnlockPassword.length > 0 &&
    deleteVaultNameConfirmation === selectedVault.metadata.name &&
    !workspacePending

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
      {statusNotice ? (
        <Alert>
          <RefreshCcw className="size-4" />
          <AlertTitle>Workspace status</AlertTitle>
          <AlertDescription>{statusNotice}</AlertDescription>
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
                  <div className="inline-flex rounded-md shadow-xs">
                    <Button
                      variant="outline"
                      className="rounded-r-none border-r-0"
                      onClick={handleStartCreateEntryDialog}
                      disabled={!selectedVault || workspacePending}
                    >
                      <Plus className="mr-2 size-4" />
                      New entry
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="rounded-l-none px-2"
                          aria-label="Choose entry template"
                          data-testid="password-manager-entry-template-menu"
                          disabled={!selectedVault || workspacePending}
                        >
                          <ChevronsUpDown className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuLabel>Entry template</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={selectedEntryTemplateId}
                          onValueChange={(value) => onEntryTemplateChange(value as PasswordManagerEntryTemplateId)}
                        >
                          {PASSWORD_MANAGER_ENTRY_TEMPLATES.map((template) => (
                            <DropdownMenuRadioItem key={template.id} value={template.id}>
                              <div className="grid gap-0.5">
                                <span>{template.label}</span>
                                <span className="text-xs text-muted-foreground">{template.description}</span>
                              </div>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
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
              <div className="rounded-lg border border-border/60" data-testid="password-manager-entry-table">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entry</TableHead>
                      <TableHead className="hidden md:table-cell">Username</TableHead>
                      <TableHead className="hidden lg:table-cell">URL</TableHead>
                      <TableHead className="hidden sm:table-cell">Key</TableHead>
                      <TableHead className="w-12 sm:w-[116px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                {entries.map((entry) => (
                  <TableRow
                    key={entry.id}
                    data-state={selectedEntry?.id === entry.id ? 'selected' : undefined}
                    data-testid={`password-manager-entry-${entry.id}`}
                  >
                    <TableCell className="min-w-[220px]">
                      <button type="button" className="flex min-w-0 items-start gap-2 text-left" onClick={() => onSelectEntry(entry.id)}>
                          {getPasswordManagerEntryIcon(entry.payload.type)}
                          <div className="min-w-0">
                            <p className="truncate font-medium">{entry.payload.title}</p>
                            <p className="truncate text-sm text-muted-foreground">{getPasswordManagerEntrySummaryText(entry)}</p>
                            {entry.payload.url ? <p className="truncate text-xs text-muted-foreground lg:hidden">{entry.payload.url}</p> : null}
                          </div>
                      </button>
                      {entryRevealId === entry.id && entry.payload.password ? (
                        <div className="mt-2 space-y-2">
                          <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 font-mono text-sm break-all">
                            {entry.payload.password}
                          </p>
                          <TimedSecretProgress
                            durationLabel={`${revealedPasswords[entry.id]?.durationSeconds ?? getVaultRevealTimeoutSeconds(selectedVault)}s reveal`}
                            progressPercent={getTimedSecretProgressPercent(revealedPasswords[entry.id], timedSecretNow)}
                            testId={`password-manager-reveal-progress-${entry.id}`}
                          />
                        </div>
                      ) : null}
                      {clipboardPasswords[entry.id] ? (
                        <div className="mt-2">
                          <TimedSecretProgress
                            durationLabel={`${clipboardPasswords[entry.id]?.durationSeconds ?? getVaultClipboardTimeoutSeconds(selectedVault)}s clipboard`}
                            progressPercent={getTimedSecretProgressPercent(clipboardPasswords[entry.id], timedSecretNow)}
                            testId={`password-manager-clipboard-progress-${entry.id}`}
                          />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden max-w-[180px] truncate md:table-cell">
                      {entry.payload.username ?? 'Not set'}
                    </TableCell>
                    <TableCell className="hidden max-w-[220px] truncate lg:table-cell">
                      {entry.payload.url ?? 'Not set'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline">Epoch {entry.keyEpoch}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="hidden justify-end gap-1.5 sm:flex">
                      {entry.payload.password ? (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                onClick={() => void onToggleReveal(entry)}
                                aria-label={entryRevealId === entry.id ? 'Hide password' : 'Reveal password'}
                                title={entryRevealId === entry.id ? 'Hide password' : 'Reveal password'}
                              >
                                {entryRevealId === entry.id ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {entryRevealId === entry.id ? 'Hide password' : 'Reveal password'}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                onClick={() => void onCopyPassword(entry)}
                                aria-label="Copy password"
                                title="Copy password"
                              >
                                <Copy className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Copy password</TooltipContent>
                          </Tooltip>
                        </>
                      ) : null}
                      {entry.payload.type === 'ssh-key-pair' ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon-sm"
                              onClick={() => handleStartViewEntryDialog(entry)}
                              aria-label="View entry"
                              title="View entry"
                            >
                              <Eye className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View entry</TooltipContent>
                        </Tooltip>
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            onClick={() => handleStartEditEntryDialog(entry)}
                            aria-label="Edit entry"
                            title="Edit entry"
                          >
                            <Pencil className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit entry</TooltipContent>
                      </Tooltip>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="icon" className="sm:hidden" aria-label={`Open actions for ${entry.payload.title}`}>
                            <Ellipsis className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {entry.payload.password ? (
                            <>
                              <DropdownMenuItem onSelect={() => void onToggleReveal(entry)}>
                                {entryRevealId === entry.id ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                {entryRevealId === entry.id ? 'Hide password' : 'Reveal password'}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void onCopyPassword(entry)}>
                                <Copy className="size-4" />
                                Copy password
                              </DropdownMenuItem>
                            </>
                          ) : null}
                          {entry.payload.type === 'ssh-key-pair' ? (
                            <DropdownMenuItem onSelect={() => handleStartViewEntryDialog(entry)}>
                              <Eye className="size-4" />
                              View
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onSelect={() => handleStartEditEntryDialog(entry)}>
                            <Pencil className="size-4" />
                            Edit
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Dialog open={entryDialogOpen} onOpenChange={handleEntryDialogOpenChange}>
            <DialogContent
              className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl"
              data-testid="password-manager-entry-dialog"
            >
              <DialogHeader>
                <DialogTitle>
                  {isViewingEntry ? 'View' : editingEntryId ? 'Edit' : 'New'} {activeEntryTemplate.dialogLabel}
                </DialogTitle>
                <DialogDescription>
                  {isViewingEntry
                    ? 'This encrypted payload is open read-only in browser memory.'
                    : editingEntryId
                    ? 'Updating re-encrypts the entire payload in browser memory before upload.'
                    : 'The template payload is encrypted locally before it leaves the browser.'}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="password-manager-entry-title">Title</Label>
                  <Input
                    id="password-manager-entry-title"
                    value={entryTitle}
                    onChange={(event) => onEntryTitleChange(event.target.value)}
                    disabled={!selectedVault || isViewingEntry}
                  />
                </div>
                {activeEntryTemplate.id === 'ssh-key-pair' && !isViewingEntry ? (
                  <div className="grid gap-4 rounded-md border border-border/60 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="password-manager-ssh-key-algorithm">Algorithm</Label>
                        <Select
                          value={sshKeyAlgorithm}
                          onValueChange={(value) => setSshKeyAlgorithm(value as PasswordManagerSshKeyAlgorithm)}
                          disabled={!selectedVault || sshKeyGenerationPending}
                        >
                          <SelectTrigger id="password-manager-ssh-key-algorithm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ed25519">ED25519</SelectItem>
                            <SelectItem value="rsa">RSA 4096</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleGenerateSshKeyPair()}
                          disabled={!selectedVault || sshKeyGenerationPending}
                        >
                          <FileKey className="mr-2 size-4" />
                          {sshKeyGenerationPending ? 'Generating...' : 'Generate key pair'}
                        </Button>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={sshKeyPassphraseEnabled}
                        onChange={(event) => {
                          setSshKeyPassphraseEnabled(event.target.checked)
                          setSshKeyGenerationError(null)
                        }}
                        disabled={!selectedVault || sshKeyGenerationPending}
                      />
                      Password protect generated private key
                    </label>
                    {sshKeyPassphraseEnabled ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="relative grid gap-2">
                          <Label htmlFor="password-manager-ssh-key-passphrase">Key passphrase</Label>
                          <Input
                            id="password-manager-ssh-key-passphrase"
                            type={visibleEntryPasswordFields.sshKeyPassphrase ? 'text' : 'password'}
                            value={sshKeyPassphrase}
                            onChange={(event) => setSshKeyPassphrase(event.target.value)}
                            disabled={!selectedVault || sshKeyGenerationPending}
                            className="pr-10"
                          />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="absolute right-1 bottom-1"
                                onClick={() => toggleEntryPasswordFieldVisibility('sshKeyPassphrase')}
                                disabled={!selectedVault || sshKeyGenerationPending}
                                aria-label={visibleEntryPasswordFields.sshKeyPassphrase ? 'Hide key passphrase' : 'Show key passphrase'}
                                title={visibleEntryPasswordFields.sshKeyPassphrase ? 'Hide key passphrase' : 'Show key passphrase'}
                              >
                                {visibleEntryPasswordFields.sshKeyPassphrase ? (
                                  <EyeOff className="size-4" />
                                ) : (
                                  <Eye className="size-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {visibleEntryPasswordFields.sshKeyPassphrase ? 'Hide key passphrase' : 'Show key passphrase'}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="relative grid gap-2">
                          <Label htmlFor="password-manager-ssh-key-passphrase-confirm">Confirm key passphrase</Label>
                          <Input
                            id="password-manager-ssh-key-passphrase-confirm"
                            type={visibleEntryPasswordFields.sshKeyPassphraseConfirm ? 'text' : 'password'}
                            value={sshKeyPassphraseConfirm}
                            onChange={(event) => setSshKeyPassphraseConfirm(event.target.value)}
                            disabled={!selectedVault || sshKeyGenerationPending}
                            className="pr-10"
                          />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="absolute right-1 bottom-1"
                                onClick={() => toggleEntryPasswordFieldVisibility('sshKeyPassphraseConfirm')}
                                disabled={!selectedVault || sshKeyGenerationPending}
                                aria-label={
                                  visibleEntryPasswordFields.sshKeyPassphraseConfirm
                                    ? 'Hide confirm key passphrase'
                                    : 'Show confirm key passphrase'
                                }
                                title={
                                  visibleEntryPasswordFields.sshKeyPassphraseConfirm
                                    ? 'Hide confirm key passphrase'
                                    : 'Show confirm key passphrase'
                                }
                              >
                                {visibleEntryPasswordFields.sshKeyPassphraseConfirm ? (
                                  <EyeOff className="size-4" />
                                ) : (
                                  <Eye className="size-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {visibleEntryPasswordFields.sshKeyPassphraseConfirm
                                ? 'Hide confirm key passphrase'
                                : 'Show confirm key passphrase'}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ) : null}
                    {sshKeyGenerationError ? (
                      <p className="text-sm text-destructive">{sshKeyGenerationError}</p>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  {activeEntryTemplate.fields.map((field) => {
                    const fieldId = `password-manager-entry-${field.id}`
                    const value =
                      field.id === 'username'
                        ? entryUsername
                        : field.id === 'password'
                          ? entryPassword
                          : field.id === 'url'
                            ? entryUrl
                            : entryFields[field.id] ?? ''
                    const handleChange = (nextValue: string) => {
                      if (field.id === 'username') {
                        onEntryUsernameChange(nextValue)
                      } else if (field.id === 'password') {
                        onEntryPasswordChange(nextValue)
                      } else if (field.id === 'url') {
                        onEntryUrlChange(nextValue)
                      } else {
                        onEntryFieldChange(field.id, nextValue)
                      }
                    }
                    const sshCopyLabel =
                      field.id === 'publicMaterial'
                        ? 'Copy public key or certificate'
                        : field.id === 'privateKey'
                          ? 'Copy private key'
                          : `Copy ${field.label.toLowerCase()}`
                    const canCopySshField =
                      isViewingEntry && activeEntryTemplate.id === 'ssh-key-pair' && !!editingEntryId && !!selectedEntry && !!value
                    const canGeneratePassword = field.id === 'password' && !isViewingEntry
                    const canTogglePasswordVisibility = field.type === 'password' && !isViewingEntry
                    const passwordVisibilityLabel = field.label.toLowerCase()
                    const fieldContainerClassName =
                      field.multiline || canGeneratePassword
                        ? 'relative grid gap-2 sm:col-span-2'
                        : canTogglePasswordVisibility
                          ? 'relative grid gap-2'
                          : 'grid gap-2'

                    return (
                      <div
                        key={field.id}
                        className={fieldContainerClassName}
                        data-testid={`password-manager-entry-field-${field.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor={fieldId}>{field.label}</Label>
                          {canGeneratePassword ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setPasswordGeneratorDialogOpen(true)}
                              disabled={!selectedVault}
                            >
                              <KeyRound className="size-4" />
                              Generate password
                            </Button>
                          ) : canCopySshField ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => void onCopyEntryField(selectedEntry!, field.id, field.label)}
                                  aria-label={sshCopyLabel}
                                  title={sshCopyLabel}
                                >
                                  <Copy className="size-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{sshCopyLabel}</TooltipContent>
                            </Tooltip>
                          ) : activeEntryTemplate.id === 'ssh-key-pair' && !isViewingEntry ? (
                            <Label
                              htmlFor={`${fieldId}-file`}
                              className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
                            >
                              Upload file
                            </Label>
                          ) : null}
                        </div>
                        {field.multiline ? (
                          <Textarea
                            id={fieldId}
                            value={value}
                            onChange={(event) => handleChange(event.target.value)}
                            disabled={!selectedVault || isViewingEntry}
                            className={activeEntryTemplate.id === 'ssh-key-pair' ? 'min-h-36 font-mono text-xs' : undefined}
                          />
                        ) : (
                          <>
                            <Input
                              id={fieldId}
                              type={canTogglePasswordVisibility && visibleEntryPasswordFields[field.id] ? 'text' : field.type}
                              value={value}
                              onChange={(event) => handleChange(event.target.value)}
                              disabled={!selectedVault || isViewingEntry}
                              className={canTogglePasswordVisibility ? 'pr-10' : undefined}
                            />
                            {canTogglePasswordVisibility ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="absolute right-1 bottom-1"
                                    onClick={() => toggleEntryPasswordFieldVisibility(field.id)}
                                    disabled={!selectedVault}
                                    aria-label={
                                      visibleEntryPasswordFields[field.id]
                                        ? `Hide ${passwordVisibilityLabel}`
                                        : `Show ${passwordVisibilityLabel}`
                                    }
                                    title={
                                      visibleEntryPasswordFields[field.id]
                                        ? `Hide ${passwordVisibilityLabel}`
                                        : `Show ${passwordVisibilityLabel}`
                                    }
                                  >
                                    {visibleEntryPasswordFields[field.id] ? (
                                      <EyeOff className="size-4" />
                                    ) : (
                                      <Eye className="size-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {visibleEntryPasswordFields[field.id]
                                    ? `Hide ${passwordVisibilityLabel}`
                                    : `Show ${passwordVisibilityLabel}`}
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </>
                        )}
                        {activeEntryTemplate.id === 'ssh-key-pair' && !isViewingEntry ? (
                          <Input
                            id={`${fieldId}-file`}
                            type="file"
                            className="sr-only"
                            onChange={(event) => {
                              void handleSshKeyFileUpload(field.id, event.target.files?.[0])
                              event.target.value = ''
                            }}
                            disabled={!selectedVault}
                          />
                        ) : null}
                      </div>
                    )
                  })}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password-manager-entry-notes">Notes</Label>
                  <Textarea
                    id="password-manager-entry-notes"
                    value={entryNotes}
                    onChange={(event) => onEntryNotesChange(event.target.value)}
                    disabled={!selectedVault || isViewingEntry}
                  />
                </div>
              </div>
              <DialogFooter>
                {isViewingEntry ? (
                  <Button variant="outline" onClick={() => setEntryDialogOpen(false)}>
                    Close
                  </Button>
                ) : null}
                {!isViewingEntry && editingEntryId && selectedEntry ? (
                  <Button variant="destructive" onClick={() => void handleEntryDeleteFromDialog()} disabled={workspacePending}>
                    <Trash2 className="mr-2 size-4" />
                    Delete entry
                  </Button>
                ) : null}
                {!isViewingEntry ? (
                  <Button onClick={() => void handleEntrySaveFromDialog()} disabled={!selectedVault || workspacePending}>
                    {workspacePending ? 'Saving...' : editingEntryId ? 'Save encrypted entry' : 'Create encrypted entry'}
                  </Button>
                ) : null}
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={passwordGeneratorDialogOpen} onOpenChange={setPasswordGeneratorDialogOpen}>
            <DialogContent
              className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-5xl"
              data-testid="password-manager-generator-dialog"
            >
              <DialogHeader>
                <DialogTitle>Password Generator</DialogTitle>
                <DialogDescription>
                  Generate a password locally, then insert it into this entry.
                </DialogDescription>
              </DialogHeader>
              <PasswordGeneratorTool
                showHeading={false}
                onUsePassword={(generatedPassword) => {
                  onEntryPasswordChange(generatedPassword)
                  setPasswordGeneratorDialogOpen(false)
                }}
              />
            </DialogContent>
          </Dialog>
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
                <div className="grid gap-2">
                  <Label htmlFor="password-manager-vault-reveal-timeout">Reveal password duration</Label>
                  <Input
                    id="password-manager-vault-reveal-timeout"
                    type="number"
                    min={MIN_PASSWORD_TIMEOUT_SECONDS}
                    max={MAX_PASSWORD_TIMEOUT_SECONDS}
                    value={renameRevealTimeoutSeconds}
                    onChange={(event) => onRenameRevealTimeoutSecondsChange(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Seconds before revealed passwords are hidden again.</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password-manager-vault-clipboard-timeout">Clipboard clear duration</Label>
                  <Input
                    id="password-manager-vault-clipboard-timeout"
                    type="number"
                    min={MIN_PASSWORD_TIMEOUT_SECONDS}
                    max={MAX_PASSWORD_TIMEOUT_SECONDS}
                    value={renameClipboardTimeoutSeconds}
                    onChange={(event) => onRenameClipboardTimeoutSecondsChange(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Seconds before Password Manager clears its copied value.</p>
                </div>
              </CardContent>
              <CardFooter className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void onRenameVault()} disabled={workspacePending}>
                  <Pencil className="mr-2 size-4" />
                  Save Settings
                </Button>
                <Button variant="destructive" onClick={() => setDeleteVaultDialogOpen(true)} disabled={workspacePending}>
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

          <AlertDialog open={deleteVaultDialogOpen} onOpenChange={handleDeleteVaultDialogOpenChange}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete vault</AlertDialogTitle>
                <AlertDialogDescription>
                  This is irreversible. Deleting this vault permanently removes its encrypted metadata, wrapped keys,
                  entries, and membership records.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="grid gap-4">
                {deleteVaultError ? (
                  <Alert variant="destructive">
                    <ShieldAlert className="size-4" />
                    <AlertTitle>Delete blocked</AlertTitle>
                    <AlertDescription>{deleteVaultError}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="password-manager-delete-unlock-password">Unlock password</Label>
                  <Input
                    id="password-manager-delete-unlock-password"
                    type="password"
                    value={deleteVaultUnlockPassword}
                    autoComplete="current-password"
                    onChange={(event) => setDeleteVaultUnlockPassword(event.target.value)}
                    disabled={workspacePending}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password-manager-delete-vault-name">Type the vault name</Label>
                  <Input
                    id="password-manager-delete-vault-name"
                    value={deleteVaultNameConfirmation}
                    onChange={(event) => setDeleteVaultNameConfirmation(event.target.value)}
                    placeholder={selectedVault?.metadata.name}
                    disabled={workspacePending}
                  />
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={workspacePending}>Cancel</AlertDialogCancel>
                <Button variant="destructive" onClick={() => void handleConfirmVaultDelete()} disabled={!deleteVaultEnabled}>
                  Delete vault permanently
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

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
                      <Label>Instance user</Label>
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
                            <CommandInput placeholder="Search instance users..." />
                            <CommandList>
                              <CommandEmpty>No instance users found.</CommandEmpty>
                              <CommandGroup>
                                {instanceUsers.map((user) => {
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
