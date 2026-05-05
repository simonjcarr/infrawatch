'use client'

import { useEffect, useMemo, useReducer } from 'react'
import { AlertCircle, KeyRound, Lock, RefreshCcw, ShieldAlert, Vault } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { logWarn } from '@/lib/logging'
import { createPasswordManagerClient } from '@/lib/password-manager/client'
import {
  createInitialPasswordManagerShellState,
  mapPasswordManagerErrorToShellView,
  reducePasswordManagerShellState,
  type PasswordManagerShellState,
} from '@/lib/password-manager/shell'

const PASSWORD_MANAGER_API_BASE_URL =
  process.env.NEXT_PUBLIC_PASSWORD_MANAGER_API_BASE_URL?.trim() || '/password-manager-api/'
const PASSWORD_MANAGER_LAUNCH_PATH = '/api/password-manager/launch-assertion'

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

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6" data-testid="password-manager-shell">
      <header className="flex flex-col gap-3 rounded-3xl border border-border/60 bg-linear-to-br from-background via-background to-muted/40 p-6 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">Tooling</Badge>
          <Badge variant="secondary">Hosted at /password-manager</Badge>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Password Manager</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            CT-Ops launches the Password Manager session, but secret material remains in browser-only code paths.
          </p>
        </div>
      </header>

      <PasswordManagerShellCard state={state} onRetry={() => dispatch({ type: 'restart-launch' })} />
    </section>
  )
}

function PasswordManagerShellCard({
  state,
  onRetry,
}: {
  state: PasswordManagerShellState
  onRetry: () => void
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
      return (
        <ShellCard
          icon={KeyRound}
          eyebrow={state.setupConfigured ? 'Locked' : 'First use'}
          title={state.setupConfigured ? 'Unlock your Password Manager workspace' : 'Set up your unlock profile'}
          description={
            state.setupConfigured
              ? 'Your encrypted unlock profile is available. The unlock controls and vault workspace attach to this shell next.'
              : 'No encrypted unlock profile is stored yet. The browser-side setup and unlock flow attaches to this shell next.'
          }
          statusLabel={state.setupConfigured ? 'Locked' : 'Setup required'}
          statusVariant="outline"
          testId="password-manager-state-locked"
          footer={
            <Alert>
              <Lock className="size-4" />
              <AlertTitle>Browser-only boundary preserved</AlertTitle>
              <AlertDescription>
                CT-Ops only brokers launch assertions. Vault keys, unlock secrets, and plaintext values stay out of this route shell.
              </AlertDescription>
            </Alert>
          }
        />
      )
    case 'unlocked':
      return (
        <ShellCard
          icon={Vault}
          eyebrow="Unlocked"
          title="Password Manager workspace is active"
          description="Vaults, entries, sharing controls, and audit-aware actions render inside this shell once the unlock session is active."
          statusLabel="Unlocked"
          statusVariant="secondary"
          testId="password-manager-state-unlocked"
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
          actions={<Button variant="outline" onClick={onRetry}>Retry launch</Button>}
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
          actions={<Button variant="outline" onClick={onRetry}>Retry launch</Button>}
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
  actions?: React.ReactNode
  footer?: React.ReactNode
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
