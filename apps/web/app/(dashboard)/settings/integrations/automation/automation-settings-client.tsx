'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Bot, CheckCircle2, CircleOff, KeyRound, RotateCw, ServerCog, Trash2, XCircle } from 'lucide-react'

import {
  createAnsibleCredentialProfile,
  deleteAnsibleCredentialProfile,
  pairAnsibleModuleConnection,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

interface AutomationSettingsClientProps {
  initialSettings: AutomationSettingsResult
  initialCredentialProfiles: AnsibleCredentialProfileSummary[]
}

const ANSIBLE_API_IMAGE = 'ghcr.io/carrtech-dev/ct-ops/ansible-api:latest'
const ANSIBLE_ENV_SNIPPET = [
  'ANSIBLE_API_PAIRING_USERNAME=ctops',
  'ANSIBLE_API_PAIRING_PASSWORD=<initial password>',
].join('\n')
const ANSIBLE_COMPOSE_COMMAND = 'docker compose -f docker-compose.single.yml --profile ansible up -d ansible-api'
const ANSIBLE_HEALTH_COMMAND = 'docker compose -f docker-compose.single.yml ps ansible-api'
const ANSIBLE_DOCKER_RUN_COMMAND = [
  'docker run -d --name ct-ops-ansible-api \\',
  '  --restart unless-stopped \\',
  '  -p 127.0.0.1:8080:8080 \\',
  '  -e ANSIBLE_API_PAIRING_USERNAME=ctops \\',
  '  -e ANSIBLE_API_PAIRING_PASSWORD="$ANSIBLE_API_PAIRING_PASSWORD" \\',
  '  -v ct-ops-ansible-api-data:/var/lib/ct-ops/ansible-api \\',
  `  ${ANSIBLE_API_IMAGE}`,
].join('\n')

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
  const [connectionBaseUrl, setConnectionBaseUrl] = useState(settings.ansibleConnection.baseUrl)
  const [pairingUsername, setPairingUsername] = useState('ctops')
  const [pairingPassword, setPairingPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [credentialError, setCredentialError] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [connectionSaved, setConnectionSaved] = useState(false)
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
        ansibleConnection: {
          ...settings.ansibleConnection,
          enabled: nextEnabled,
        },
        status: nextEnabled ? 'unavailable' : 'disabled',
        statusMessage: nextEnabled
          ? 'Ansible automation is enabled. Pair the Ansible API connection and check service health.'
          : 'Ansible automation is disabled for this instance.',
        ansibleVersion: undefined,
      })
      setTimeout(() => setSaved(false), 3000)
    },
    onError: () => setError('An unexpected error occurred'),
  })

  const pairConnection = useMutation({
    mutationFn: () => pairAnsibleModuleConnection({
      baseUrl: connectionBaseUrl,
      username: pairingUsername,
      password: pairingPassword,
    }),
    onSuccess: (result) => {
      if ('error' in result) {
        setConnectionError(result.error)
        return
      }
      setConnectionError(null)
      setPairingPassword('')
      setConnectionSaved(true)
      setSettings({
        ...settings,
        ansibleConnection: result.connection,
        status: enabled ? 'unavailable' : settings.status,
        statusMessage: enabled
          ? 'Ansible automation connection is paired. Refresh status to confirm service health.'
          : settings.statusMessage,
        ansibleVersion: undefined,
      })
      setTimeout(() => setConnectionSaved(false), 3000)
    },
    onError: () => setConnectionError('Failed to pair Ansible connection'),
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
                Stores the opt-in in the database. CT-Ops calls the configured Ansible API; it does not need to run the container itself.
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
            <AlertDescription className="space-y-2">
              <p>
                {settings.statusMessage}
                {settings.ansibleVersion ? ` Ansible version: ${settings.ansibleVersion}.` : ''}
              </p>
              <p>
                Pull the latest Ansible API image from{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{ANSIBLE_API_IMAGE}</code>.
              </p>
              <details className="rounded-md border bg-background/70 px-3 py-2">
                <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
                  Run the Ansible container
                </summary>
                <Tabs defaultValue="bundled" className="mt-3">
                  <TabsList className="h-auto flex-wrap justify-start">
                    <TabsTrigger value="bundled">Bundled Compose</TabsTrigger>
                    <TabsTrigger value="separate">Separate Server</TabsTrigger>
                  </TabsList>

                  <TabsContent value="bundled" className="space-y-3 text-sm text-muted-foreground">
                    <p>
                      Use this path when the Ansible API container runs from the CT-Ops Compose file on the same host.
                    </p>
                    <p>
                      Add initial pairing credentials to the CT-Ops <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">.env</code> file:
                    </p>
                    <pre className="overflow-x-auto whitespace-pre rounded-md bg-muted p-3 text-xs text-foreground">
                      <code>{ANSIBLE_ENV_SNIPPET}</code>
                    </pre>
                    <p>
                      Start only the optional Ansible profile, then confirm it is healthy:
                    </p>
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">
                      <code>{ANSIBLE_COMPOSE_COMMAND}</code>
                    </pre>
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">
                      <code>{ANSIBLE_HEALTH_COMMAND}</code>
                    </pre>
                    <p>
                      In this UI, use <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">http://ansible-api:8080</code> and the initial pairing credentials. CT-Ops stores only the generated service secret after pairing.
                    </p>
                  </TabsContent>

                  <TabsContent value="separate" className="space-y-3 text-sm text-muted-foreground">
                    <p>
                      Use this path when the Ansible API runs on a different server reachable from CT-Ops.
                    </p>
                    <p>
                      On the Ansible server, set the initial pairing environment variables and run the image behind a private network or reverse proxy:
                    </p>
                    <pre className="overflow-x-auto whitespace-pre rounded-md bg-muted p-3 text-xs text-foreground">
                      <code>{ANSIBLE_DOCKER_RUN_COMMAND}</code>
                    </pre>
                    <p>
                      The example binds to loopback for a reverse proxy on that server. If CT-Ops reaches the container directly over a private network, publish the port on a protected interface and allow inbound traffic only from the CT-Ops host.
                    </p>
                    <p>
                      Keep the generated token file on persistent storage. If it is deleted, reset the CT-Ops connection by pairing again with the initial credentials.
                    </p>
                  </TabsContent>
                </Tabs>
              </details>
            </AlertDescription>
          </Alert>

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
              <ServerCog className="h-4 w-4" />
              Ansible module connection
            </CardTitle>
            <CardDescription>
              Connect with the initial username and password from the Ansible container environment. CT-Ops stores the generated service secret, not this password.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ansible-connection-url">Ansible API URL</Label>
                <Input
                  id="ansible-connection-url"
                  data-testid="ansible-pairing-url"
                  type="url"
                  value={connectionBaseUrl}
                  onChange={(event) => setConnectionBaseUrl(event.target.value)}
                  placeholder="https://ansible-api.example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ansible-pairing-username">Initial username</Label>
                <Input
                  id="ansible-pairing-username"
                  data-testid="ansible-pairing-username"
                  value={pairingUsername}
                  onChange={(event) => setPairingUsername(event.target.value)}
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="ansible-pairing-password">Initial password</Label>
                <Input
                  id="ansible-pairing-password"
                  data-testid="ansible-pairing-password"
                  type="password"
                  value={pairingPassword}
                  onChange={(event) => setPairingPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </div>

            {settings.ansibleConnection.hasTokenSecret && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                Paired with <span className="font-medium text-foreground">{settings.ansibleConnection.baseUrl}</span>.
                Re-pairing with the initial credentials rotates the generated service secret.
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="button" onClick={() => pairConnection.mutate()} disabled={pairConnection.isPending}>
                <ServerCog className="h-4 w-4" />
                Pair connection
              </Button>
              {pairConnection.isPending && <span className="text-sm text-muted-foreground">Pairing...</span>}
              {connectionSaved && <span className="text-sm text-green-700">Saved</span>}
              {connectionError && <span className="text-sm text-destructive">{connectionError}</span>}
            </div>
          </CardContent>
        </Card>
      )}

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
