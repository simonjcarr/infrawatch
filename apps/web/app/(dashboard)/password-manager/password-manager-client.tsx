'use client'

import { useEffect, useMemo, useReducer, useState, type FormEvent, type ReactNode } from 'react'
import { AlertCircle, KeyRound, Lock, LogOut, RefreshCcw, ShieldAlert, Vault } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { logWarn } from '@/lib/logging'
import {
  createUnlockProfile,
  decryptUserPrivateKeyEnvelope,
  type PasswordManagerEncryptedPrivateKeyEnvelope,
  type PasswordManagerKdfMetadata,
} from '@/lib/password-manager/browser-crypto'
import { PasswordManagerApiError, createPasswordManagerClient } from '@/lib/password-manager/client'
import {
  createInitialPasswordManagerShellState,
  mapPasswordManagerErrorToShellView,
  reducePasswordManagerShellState,
  type PasswordManagerShellState,
} from '@/lib/password-manager/shell'

const PASSWORD_MANAGER_API_BASE_URL =
  process.env.NEXT_PUBLIC_PASSWORD_MANAGER_API_BASE_URL?.trim() || '/password-manager-api/'
const PASSWORD_MANAGER_LAUNCH_PATH = '/api/password-manager/launch-assertion'
const GENERIC_UNLOCK_FAILURE =
  'Password Manager could not unlock with the provided materials. Retry or relaunch.'
const GENERIC_SETUP_FAILURE = 'Password Manager setup could not be completed safely. Retry or relaunch.'

function toClientPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
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
  const [setupPassword, setSetupPassword] = useState('')
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState('')
  const [unlockPassword, setUnlockPassword] = useState('')
  const [setupPending, setSetupPending] = useState(false)
  const [unlockPending, setUnlockPending] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)

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
    </section>
  )
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
