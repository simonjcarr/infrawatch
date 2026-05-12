'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Bot, CheckCircle2, CircleOff, KeyRound, RotateCw, ServerCog, Trash2, XCircle } from 'lucide-react'

import {
  createAnsibleCredentialProfile,
  deleteAnsibleCredentialProfile,
  updateAnsibleAutomationSettings,
  type AnsibleCredentialProfileSummary,
  type AutomationSettingsResult,
} from '@/lib/actions/automation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

interface AutomationSettingsClientProps {
  initialSettings: AutomationSettingsResult
  initialCredentialProfiles: AnsibleCredentialProfileSummary[]
}

function statusBadge(settings: AutomationSettingsResult) {
  if (settings.status === 'healthy') {
    return <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Healthy</Badge>
  }
  if (settings.status === 'unavailable') {
    return <Badge variant="secondary" className="gap-1"><XCircle className="h-3 w-3" /> Restart required</Badge>
  }
  return <Badge variant="outline" className="gap-1"><CircleOff className="h-3 w-3" /> Disabled</Badge>
}

export function AutomationSettingsClient({ initialSettings, initialCredentialProfiles }: AutomationSettingsClientProps) {
  const [settings, setSettings] = useState(initialSettings)
  const [credentialProfiles, setCredentialProfiles] = useState(initialCredentialProfiles)
  const [credentialName, setCredentialName] = useState('')
  const [credentialUsername, setCredentialUsername] = useState('')
  const [credentialPrivateKey, setCredentialPrivateKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [credentialError, setCredentialError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const enabled = settings.ansibleFeatureEnabled && settings.provider === 'ansible'

  const mutation = useMutation({
    mutationFn: (nextEnabled: boolean) => updateAnsibleAutomationSettings(nextEnabled),
    onSuccess: (result, nextEnabled) => {
      if ('error' in result) {
        setError(result.error)
        return
      }
      setError(null)
      setSaved(true)
      setSettings({
        ...settings,
        ansibleFeatureEnabled: nextEnabled,
        provider: nextEnabled ? 'ansible' : 'none',
        status: nextEnabled ? 'unavailable' : 'disabled',
        statusMessage: nextEnabled
          ? 'Ansible automation is enabled. Run ./start.sh on the host to start the optional Ansible service.'
          : 'Ansible automation is disabled for this instance.',
        ansibleVersion: undefined,
      })
      setTimeout(() => setSaved(false), 3000)
    },
    onError: () => setError('An unexpected error occurred'),
  })

  const createCredential = useMutation({
    mutationFn: () => createAnsibleCredentialProfile({
      name: credentialName,
      username: credentialUsername,
      privateKey: credentialPrivateKey,
    }),
    onSuccess: (result) => {
      if ('error' in result) {
        setCredentialError(result.error)
        return
      }
      setCredentialError(null)
      setCredentialProfiles((current) => [...current, result.profile].sort((a, b) => a.name.localeCompare(b.name)))
      setCredentialName('')
      setCredentialUsername('')
      setCredentialPrivateKey('')
    },
    onError: () => setCredentialError('Failed to save credential profile'),
  })

  const deleteCredential = useMutation({
    mutationFn: (id: string) => deleteAnsibleCredentialProfile(id),
    onSuccess: (result, id) => {
      if ('error' in result) {
        setCredentialError(result.error)
        return
      }
      setCredentialProfiles((current) => current.filter((profile) => profile.id !== id))
    },
    onError: () => setCredentialError('Failed to delete credential profile'),
  })

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
        <p className="text-sm text-muted-foreground">
          Manage optional automation providers for this CT-Ops instance.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4" />
                Ansible automation
              </CardTitle>
              <CardDescription>{settings.ansibleDescription}</CardDescription>
            </div>
            {statusBadge(settings)}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-md border p-4">
            <div className="space-y-1">
              <Label htmlFor="ansible-automation-enabled">Enable Ansible provider</Label>
              <p className="text-sm text-muted-foreground">
                Stores the opt-in in the database. The container starts after an operator runs ./start.sh.
              </p>
            </div>
            <Switch
              id="ansible-automation-enabled"
              checked={enabled}
              disabled={!settings.ansibleAdminConfigurable || mutation.isPending}
              onCheckedChange={(checked) => mutation.mutate(checked)}
              data-testid="settings-automation-ansible-toggle"
            />
          </div>

          <Alert>
            <ServerCog className="h-4 w-4" />
            <AlertTitle>{settings.status === 'healthy' ? 'Service connected' : 'Deployment boundary'}</AlertTitle>
            <AlertDescription>
              {settings.statusMessage}
              {settings.ansibleVersion ? ` Ansible version: ${settings.ansibleVersion}.` : ''}
            </AlertDescription>
          </Alert>

          {enabled && settings.status !== 'healthy' && (
            <div className="rounded-md border bg-muted/40 p-4 font-mono text-sm">
              cd /path/to/ct-ops<br />
              ./start.sh
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => window.location.reload()}
            >
              <RotateCw className="h-4 w-4" />
              Refresh status
            </Button>
            {mutation.isPending && <span className="text-sm text-muted-foreground">Saving...</span>}
            {saved && <span className="text-sm text-green-700">Saved</span>}
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </CardContent>
      </Card>

      {enabled && (
        <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Ansible SSH credentials
          </CardTitle>
          <CardDescription>
            Store private-key SSH profiles used by Ansible ping runs. Private keys are encrypted at rest and never sent to the browser after save.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ansible-credential-name">Profile name</Label>
              <Input
                id="ansible-credential-name"
                value={credentialName}
                onChange={(event) => setCredentialName(event.target.value)}
                placeholder="Linux admin key"
                data-testid="ansible-credential-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ansible-credential-username">SSH username</Label>
              <Input
                id="ansible-credential-username"
                value={credentialUsername}
                onChange={(event) => setCredentialUsername(event.target.value)}
                placeholder="deploy"
                data-testid="ansible-credential-username"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ansible-credential-private-key">Private key</Label>
            <Textarea
              id="ansible-credential-private-key"
              value={credentialPrivateKey}
              onChange={(event) => setCredentialPrivateKey(event.target.value)}
              className="font-mono text-xs"
              rows={7}
              placeholder="Paste an OpenSSH private key"
              data-testid="ansible-credential-private-key"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={() => createCredential.mutate()}
              disabled={createCredential.isPending}
              data-testid="ansible-credential-save"
            >
              <KeyRound className="h-4 w-4" />
              Save credential
            </Button>
            {credentialError && <span className="text-sm text-destructive">{credentialError}</span>}
          </div>

          <div className="rounded-md border">
            {credentialProfiles.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No Ansible credential profiles saved.</p>
            ) : (
              <div className="divide-y">
                {credentialProfiles.map((profile) => (
                  <div key={profile.id} className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-sm font-medium">{profile.name}</p>
                      <p className="text-xs text-muted-foreground">{profile.username}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteCredential.mutate(profile.id)}
                      disabled={deleteCredential.isPending}
                      aria-label={`Delete ${profile.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
        </Card>
      )}
    </div>
  )
}
