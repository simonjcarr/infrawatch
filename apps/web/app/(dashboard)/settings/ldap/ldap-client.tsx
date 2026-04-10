'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  Plus,
  FolderTree,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Trash2,
  Plug,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  getLdapConfigurations,
  createLdapConfiguration,
  updateLdapConfiguration,
  deleteLdapConfiguration,
  testLdapConnection,
  syncLdapAccounts,
} from '@/lib/actions/ldap'
import type { LdapConfiguration, LdapSyncStatus } from '@/lib/db/schema'

function SyncStatusBadge({ status }: { status: LdapSyncStatus | null }) {
  switch (status) {
    case 'success':
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
          <CheckCircle2 className="size-3 mr-1" />
          Success
        </Badge>
      )
    case 'error':
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
          <XCircle className="size-3 mr-1" />
          Error
        </Badge>
      )
    case 'running':
      return (
        <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">
          <Loader2 className="size-3 mr-1 animate-spin" />
          Running
        </Badge>
      )
    default:
      return <Badge variant="outline">Never synced</Badge>
  }
}

const EMPTY_FORM = {
  name: '',
  host: '',
  port: 389,
  useTls: false,
  useStartTls: false,
  baseDn: '',
  bindDn: '',
  bindPassword: '',
  userSearchBase: '',
  userSearchFilter: '(uid={{username}})',
  groupSearchBase: '',
  groupSearchFilter: '',
  usernameAttribute: 'uid',
  emailAttribute: 'mail',
  displayNameAttribute: 'cn',
  allowLogin: false,
  syncIntervalMinutes: 60,
}

export function LdapSettingsClient({
  orgId,
  initialConfigs,
}: {
  orgId: string
  initialConfigs: LdapConfiguration[]
}) {
  const queryClient = useQueryClient()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM })
  const [addError, setAddError] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success?: boolean; error?: string }>>({})
  const [syncResults, setSyncResults] = useState<Record<string, { success?: boolean; count?: number; error?: string }>>({})

  const { data: configs = initialConfigs } = useQuery({
    queryKey: ['ldap-configs', orgId],
    queryFn: () => getLdapConfigurations(orgId),
    initialData: initialConfigs,
  })

  const addMutation = useMutation({
    mutationFn: () => createLdapConfiguration(orgId, addForm),
    onSuccess: (result) => {
      if ('error' in result) {
        setAddError(result.error)
        return
      }
      setShowAddDialog(false)
      setAddForm({ ...EMPTY_FORM })
      setAddError(null)
      queryClient.invalidateQueries({ queryKey: ['ldap-configs'] })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateLdapConfiguration(orgId, id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ldap-configs'] }),
  })

  const toggleLoginMutation = useMutation({
    mutationFn: ({ id, allowLogin }: { id: string; allowLogin: boolean }) =>
      updateLdapConfiguration(orgId, id, { allowLogin }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ldap-configs'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLdapConfiguration(orgId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ldap-configs'] }),
  })

  async function handleTest(configId: string) {
    setTestResults((prev) => ({ ...prev, [configId]: {} }))
    const result = await testLdapConnection(orgId, configId)
    if ('error' in result) {
      setTestResults((prev) => ({ ...prev, [configId]: { error: result.error } }))
    } else {
      setTestResults((prev) => ({ ...prev, [configId]: { success: true } }))
    }
  }

  async function handleSync(configId: string) {
    setSyncResults((prev) => ({ ...prev, [configId]: {} }))
    const result = await syncLdapAccounts(orgId, configId)
    if ('error' in result) {
      setSyncResults((prev) => ({ ...prev, [configId]: { error: result.error } }))
    } else {
      setSyncResults((prev) => ({ ...prev, [configId]: { success: true, count: result.count } }))
      queryClient.invalidateQueries({ queryKey: ['ldap-configs'] })
      queryClient.invalidateQueries({ queryKey: ['domain-accounts'] })
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">LDAP / Directory</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure LDAP or Active Directory connections for account sync and login.
          </p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4 mr-1.5" />
              Add Configuration
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add LDAP Configuration</DialogTitle>
              <DialogDescription>
                Connect to an LDAP or Active Directory server.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Configuration Name</Label>
                <Input
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  placeholder="e.g. Corporate AD"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label>Host</Label>
                  <Input
                    value={addForm.host}
                    onChange={(e) => setAddForm({ ...addForm, host: e.target.value })}
                    placeholder="ldap.example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Port</Label>
                  <Input
                    type="number"
                    value={addForm.port}
                    onChange={(e) => setAddForm({ ...addForm, port: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={addForm.useTls}
                    onCheckedChange={(checked) => setAddForm({ ...addForm, useTls: checked, port: checked ? 636 : 389 })}
                  />
                  Use TLS (LDAPS)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={addForm.useStartTls}
                    onCheckedChange={(checked) => setAddForm({ ...addForm, useStartTls: checked })}
                  />
                  Use STARTTLS
                </label>
              </div>
              <div className="space-y-1.5">
                <Label>Base DN</Label>
                <Input
                  value={addForm.baseDn}
                  onChange={(e) => setAddForm({ ...addForm, baseDn: e.target.value })}
                  placeholder="dc=example,dc=com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Bind DN</Label>
                <Input
                  value={addForm.bindDn}
                  onChange={(e) => setAddForm({ ...addForm, bindDn: e.target.value })}
                  placeholder="cn=admin,dc=example,dc=com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Bind Password</Label>
                <Input
                  type="password"
                  value={addForm.bindPassword}
                  onChange={(e) => setAddForm({ ...addForm, bindPassword: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>User Search Base (optional)</Label>
                <Input
                  value={addForm.userSearchBase}
                  onChange={(e) => setAddForm({ ...addForm, userSearchBase: e.target.value })}
                  placeholder="ou=users"
                />
              </div>
              <div className="space-y-1.5">
                <Label>User Search Filter</Label>
                <Input
                  value={addForm.userSearchFilter}
                  onChange={(e) => setAddForm({ ...addForm, userSearchFilter: e.target.value })}
                  placeholder="(uid={{username}})"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-sm">Allow Web UI Login</Label>
                <Switch
                  checked={addForm.allowLogin}
                  onCheckedChange={(checked) => setAddForm({ ...addForm, allowLogin: checked })}
                />
              </div>
              {addError && <p className="text-sm text-destructive">{addError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button
                onClick={() => addMutation.mutate()}
                disabled={addMutation.isPending || !addForm.name || !addForm.host || !addForm.baseDn || !addForm.bindDn || !addForm.bindPassword}
              >
                {addMutation.isPending ? 'Adding...' : 'Add'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {configs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FolderTree className="size-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground font-medium">No LDAP configurations</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add an LDAP or Active Directory configuration to sync directory accounts and enable domain login.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {configs.map((config) => (
            <Card key={config.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FolderTree className="size-4 text-muted-foreground" />
                      {config.name}
                      {!config.enabled && (
                        <Badge variant="outline" className="text-xs">Disabled</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs mt-1">
                      {config.useTls ? 'ldaps' : 'ldap'}://{config.host}:{config.port}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={config.enabled}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: config.id, enabled: checked })}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Base DN</span>
                    <p className="font-mono text-xs mt-0.5">{config.baseDn}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Bind DN</span>
                    <p className="font-mono text-xs mt-0.5 truncate">{config.bindDn}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">User Filter</span>
                    <p className="font-mono text-xs mt-0.5">{config.userSearchFilter}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Sync Status:</span>
                    <SyncStatusBadge status={config.lastSyncStatus as LdapSyncStatus | null} />
                  </div>
                  {config.lastSyncAt && (
                    <span className="text-muted-foreground text-xs">
                      {formatDistanceToNow(new Date(config.lastSyncAt), { addSuffix: true })}
                    </span>
                  )}
                </div>

                {config.lastSyncError && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                    {config.lastSyncError}
                  </p>
                )}

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={config.allowLogin}
                      onCheckedChange={(checked) => toggleLoginMutation.mutate({ id: config.id, allowLogin: checked })}
                    />
                    Allow Web UI Login
                  </label>
                </div>

                {/* Test/Sync results */}
                {(() => {
                  const tr = testResults[config.id]
                  if (!tr) return null
                  return (
                    <div className={`text-sm rounded-md px-3 py-2 ${tr.success ? 'bg-green-50 text-green-800 border border-green-200' : tr.error ? 'bg-destructive/10 text-destructive border border-destructive/20' : 'bg-muted text-muted-foreground'}`}>
                      {tr.success ? 'Connection successful' : tr.error ?? 'Testing...'}
                    </div>
                  )
                })()}
                {(() => {
                  const sr = syncResults[config.id]
                  if (!sr) return null
                  return (
                    <div className={`text-sm rounded-md px-3 py-2 ${sr.success ? 'bg-green-50 text-green-800 border border-green-200' : sr.error ? 'bg-destructive/10 text-destructive border border-destructive/20' : 'bg-muted text-muted-foreground'}`}>
                      {sr.success ? `Synced ${sr.count} accounts` : sr.error ?? 'Syncing...'}
                    </div>
                  )
                })()}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(config.id)}
                    disabled={!config.enabled}
                  >
                    <Plug className="size-4 mr-1.5" />
                    Test Connection
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSync(config.id)}
                    disabled={!config.enabled}
                  >
                    <RefreshCw className="size-4 mr-1.5" />
                    Sync Now
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive ml-auto"
                    onClick={() => deleteMutation.mutate(config.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="size-4 mr-1.5" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
