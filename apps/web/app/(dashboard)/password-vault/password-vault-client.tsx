'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KeyRound, Loader2, Lock, Plus, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PasswordVaultSetupStatusResponse } from '@/lib/password-vault/profile-api'
import type { PasswordVaultResponse } from '@/lib/password-vault/vault-api'
import {
  PASSWORD_VAULT_ROUTE_TEST_IDS,
  buildPasswordVaultRouteShellState,
} from '@/lib/password-vault/route-shell'

type PasswordVaultListResponse = {
  vaults: PasswordVaultResponse[]
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Password Vault request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

function StateCard({
  state,
}: {
  state: ReturnType<typeof buildPasswordVaultRouteShellState>
}) {
  if (state.mode === 'first-use') {
    return (
      <Card data-testid={state.testId}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" />
            First use
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Create an unlock password for this browser-side vault profile. CTOps cannot recover vault data if the unlock password is lost.
          </p>
          <Button type="button" disabled data-testid={PASSWORD_VAULT_ROUTE_TEST_IDS.setupAction}>
            <KeyRound className="size-4" />
            {state.primaryAction}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (state.mode === 'locked') {
    return (
      <Card data-testid={state.testId}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="size-4 text-primary" />
            Locked
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Unlock locally to decrypt vault names and entries. Encrypted vault metadata remains hidden until the browser has the vault key.
          </p>
          <Button type="button" disabled data-testid={PASSWORD_VAULT_ROUTE_TEST_IDS.unlockAction}>
            <Lock className="size-4" />
            {state.primaryAction}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (state.mode === 'empty') {
    return (
      <Card data-testid={state.testId}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" />
            No vaults
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Start with a shared vault. Its display name and entries will be encrypted before they are sent to the server.
          </p>
          <Button type="button" disabled data-testid={PASSWORD_VAULT_ROUTE_TEST_IDS.createVaultAction}>
            <Plus className="size-4" />
            {state.primaryAction}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-testid={state.testId}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-primary" />
          Vaults ready
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Vault metadata is available to the browser. Entry management will be added on top of this shell.
        </p>
        <Button type="button" disabled data-testid={PASSWORD_VAULT_ROUTE_TEST_IDS.addEntryAction}>
          <Plus className="size-4" />
          {state.primaryAction}
        </Button>
      </CardContent>
    </Card>
  )
}

export function PasswordVaultClient() {
  const [unlocked] = useState(false)
  const setupStatusQuery = useQuery({
    queryKey: ['password-vault', 'setup-status'],
    queryFn: () => fetchJson<PasswordVaultSetupStatusResponse>('/api/password-vault/setup-status'),
    staleTime: 30_000,
  })

  const shouldListVaults = Boolean(setupStatusQuery.data?.configured && unlocked)
  const vaultsQuery = useQuery({
    queryKey: ['password-vault', 'vaults'],
    queryFn: () => fetchJson<PasswordVaultListResponse>('/api/password-vault/vaults'),
    enabled: shouldListVaults,
    staleTime: 30_000,
  })

  const state = useMemo(() => {
    if (!setupStatusQuery.data) return null
    return buildPasswordVaultRouteShellState({
      setupStatus: setupStatusQuery.data,
      unlocked,
      vaultCount: vaultsQuery.data?.vaults.length ?? 0,
    })
  }, [setupStatusQuery.data, unlocked, vaultsQuery.data?.vaults.length])

  const loading = setupStatusQuery.isLoading || (shouldListVaults && vaultsQuery.isLoading)
  const error = setupStatusQuery.error || vaultsQuery.error

  return (
    <div className="space-y-6" data-testid={PASSWORD_VAULT_ROUTE_TEST_IDS.page}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid={PASSWORD_VAULT_ROUTE_TEST_IDS.heading}>
            Password Vault
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Browser-side encrypted vaults for shared credentials.
          </p>
        </div>
      </div>

      <Alert>
        <TriangleAlert className="size-4" />
        <AlertTitle>No recovery</AlertTitle>
        <AlertDescription>
          Lost unlock credentials cannot be reset by an administrator. Keep another authorised owner available before sharing critical vaults.
        </AlertDescription>
      </Alert>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" data-testid={PASSWORD_VAULT_ROUTE_TEST_IDS.loadingState}>
          <Loader2 className="size-4 animate-spin" />
          Loading Password Vault...
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" data-testid={PASSWORD_VAULT_ROUTE_TEST_IDS.errorState}>
          <TriangleAlert className="size-4" />
          <AlertTitle>Password Vault unavailable</AlertTitle>
          <AlertDescription>Refresh the page and try again. The vault shell does not load plaintext secrets.</AlertDescription>
        </Alert>
      ) : null}

      {!loading && !error && state ? <StateCard state={state} /> : null}
    </div>
  )
}
