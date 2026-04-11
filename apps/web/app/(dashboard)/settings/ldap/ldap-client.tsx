'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  FolderTree,
  Trash2,
  Plug,
  Pencil,
  Upload,
  X,
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
} from '@/lib/actions/ldap'
import type { LdapConfiguration } from '@/lib/db/schema'

const EMPTY_FORM = {
  name: '',
  host: '',
  port: 389,
  useTls: false,
  useStartTls: false,
  tlsCertificate: '',
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
}

function CertificateUpload({
  value,
  onChange,
}: {
  value: string
  onChange: (cert: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result
      if (typeof text === 'string') onChange(text.trim())
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label>TLS Certificate (CA)</Label>
        <div className="rounded-md border bg-muted/50 px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all overflow-y-auto max-h-24 text-muted-foreground relative">
          {value}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute top-1 right-1 size-6 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => onChange('')}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label>TLS Certificate (CA)</Label>
      <input ref={fileInputRef} type="file" accept=".pem,.crt,.cer,.cert" className="hidden" onChange={handleFileUpload} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="size-4 mr-1.5" />
        Upload Certificate (.pem, .crt)
      </Button>
      <p className="text-xs text-muted-foreground">
        Upload a CA certificate to verify the LDAP server identity. Without a certificate, TLS connections will skip server verification.
      </p>
    </div>
  )
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
  const [editingConfig, setEditingConfig] = useState<LdapConfiguration | null>(null)
  const [editForm, setEditForm] = useState({ ...EMPTY_FORM })
  const [editError, setEditError] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success?: boolean; error?: string }>>({})

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

  const editMutation = useMutation({
    mutationFn: () => {
      if (!editingConfig) return Promise.reject(new Error('No config selected'))
      const updates: Record<string, unknown> = {}
      if (editForm.name !== editingConfig.name) updates.name = editForm.name
      if (editForm.host !== editingConfig.host) updates.host = editForm.host
      if (editForm.port !== editingConfig.port) updates.port = editForm.port
      if (editForm.useTls !== editingConfig.useTls) updates.useTls = editForm.useTls
      if (editForm.useStartTls !== editingConfig.useStartTls) updates.useStartTls = editForm.useStartTls
      if (editForm.tlsCertificate !== (editingConfig.tlsCertificate ?? '')) updates.tlsCertificate = editForm.tlsCertificate || null
      if (editForm.baseDn !== editingConfig.baseDn) updates.baseDn = editForm.baseDn
      if (editForm.bindDn !== editingConfig.bindDn) updates.bindDn = editForm.bindDn
      if (editForm.bindPassword) updates.bindPassword = editForm.bindPassword
      if (editForm.userSearchBase !== (editingConfig.userSearchBase ?? '')) updates.userSearchBase = editForm.userSearchBase
      if (editForm.userSearchFilter !== editingConfig.userSearchFilter) updates.userSearchFilter = editForm.userSearchFilter
      if (editForm.groupSearchBase !== (editingConfig.groupSearchBase ?? '')) updates.groupSearchBase = editForm.groupSearchBase
      if (editForm.groupSearchFilter !== (editingConfig.groupSearchFilter ?? '')) updates.groupSearchFilter = editForm.groupSearchFilter
      if (editForm.usernameAttribute !== editingConfig.usernameAttribute) updates.usernameAttribute = editForm.usernameAttribute
      if (editForm.emailAttribute !== editingConfig.emailAttribute) updates.emailAttribute = editForm.emailAttribute
      if (editForm.displayNameAttribute !== editingConfig.displayNameAttribute) updates.displayNameAttribute = editForm.displayNameAttribute
      if (editForm.allowLogin !== editingConfig.allowLogin) updates.allowLogin = editForm.allowLogin
      return updateLdapConfiguration(orgId, editingConfig.id, updates)
    },
    onSuccess: (result) => {
      if (result && 'error' in result) {
        setEditError(result.error)
        return
      }
      setEditingConfig(null)
      setEditError(null)
      queryClient.invalidateQueries({ queryKey: ['ldap-configs'] })
    },
  })

  function openEditDialog(config: LdapConfiguration) {
    setEditForm({
      name: config.name,
      host: config.host,
      port: config.port,
      useTls: config.useTls,
      useStartTls: config.useStartTls,
      tlsCertificate: config.tlsCertificate ?? '',
      baseDn: config.baseDn,
      bindDn: config.bindDn,
      bindPassword: '',
      userSearchBase: config.userSearchBase ?? '',
      userSearchFilter: config.userSearchFilter,
      groupSearchBase: config.groupSearchBase ?? '',
      groupSearchFilter: config.groupSearchFilter ?? '',
      usernameAttribute: config.usernameAttribute,
      emailAttribute: config.emailAttribute,
      displayNameAttribute: config.displayNameAttribute,
      allowLogin: config.allowLogin,
    })
    setEditError(null)
    setEditingConfig(config)
  }

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

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">LDAP / Directory</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure LDAP or Active Directory connections for domain login.
          </p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4 mr-1.5" />
              Add Configuration
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-x-hidden overflow-y-auto">
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
              {(addForm.useTls || addForm.useStartTls) && (
                <CertificateUpload
                  value={addForm.tlsCertificate}
                  onChange={(cert) => setAddForm({ ...addForm, tlsCertificate: cert })}
                />
              )}
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
              Add an LDAP or Active Directory configuration to enable domain login.
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

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={config.allowLogin}
                      onCheckedChange={(checked) => toggleLoginMutation.mutate({ id: config.id, allowLogin: checked })}
                    />
                    Allow Web UI Login
                  </label>
                </div>

                {/* Test result */}
                {(() => {
                  const tr = testResults[config.id]
                  if (!tr) return null
                  return (
                    <div className={`text-sm rounded-md px-3 py-2 ${tr.success ? 'bg-green-50 text-green-800 border border-green-200' : tr.error ? 'bg-destructive/10 text-destructive border border-destructive/20' : 'bg-muted text-muted-foreground'}`}>
                      {tr.success ? 'Connection successful' : tr.error ?? 'Testing...'}
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
                    onClick={() => openEditDialog(config)}
                  >
                    <Pencil className="size-4 mr-1.5" />
                    Edit
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

      {/* Edit LDAP Configuration Dialog */}
      <Dialog open={editingConfig !== null} onOpenChange={(open) => { if (!open) setEditingConfig(null) }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-x-hidden overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit LDAP Configuration</DialogTitle>
            <DialogDescription>
              Update your LDAP or Active Directory connection settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Configuration Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="e.g. Corporate AD"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Host</Label>
                <Input
                  value={editForm.host}
                  onChange={(e) => setEditForm({ ...editForm, host: e.target.value })}
                  placeholder="ldap.example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input
                  type="number"
                  value={editForm.port}
                  onChange={(e) => setEditForm({ ...editForm, port: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={editForm.useTls}
                  onCheckedChange={(checked) => setEditForm({ ...editForm, useTls: checked, port: checked ? 636 : 389 })}
                />
                Use TLS (LDAPS)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={editForm.useStartTls}
                  onCheckedChange={(checked) => setEditForm({ ...editForm, useStartTls: checked })}
                />
                Use STARTTLS
              </label>
            </div>
            {(editForm.useTls || editForm.useStartTls) && (
              <CertificateUpload
                value={editForm.tlsCertificate}
                onChange={(cert) => setEditForm({ ...editForm, tlsCertificate: cert })}
              />
            )}
            <div className="space-y-1.5">
              <Label>Base DN</Label>
              <Input
                value={editForm.baseDn}
                onChange={(e) => setEditForm({ ...editForm, baseDn: e.target.value })}
                placeholder="dc=example,dc=com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bind DN</Label>
              <Input
                value={editForm.bindDn}
                onChange={(e) => setEditForm({ ...editForm, bindDn: e.target.value })}
                placeholder="cn=admin,dc=example,dc=com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bind Password</Label>
              <Input
                type="password"
                value={editForm.bindPassword}
                onChange={(e) => setEditForm({ ...editForm, bindPassword: e.target.value })}
                placeholder="Leave blank to keep current password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>User Search Base (optional)</Label>
              <Input
                value={editForm.userSearchBase}
                onChange={(e) => setEditForm({ ...editForm, userSearchBase: e.target.value })}
                placeholder="ou=users"
              />
            </div>
            <div className="space-y-1.5">
              <Label>User Search Filter</Label>
              <Input
                value={editForm.userSearchFilter}
                onChange={(e) => setEditForm({ ...editForm, userSearchFilter: e.target.value })}
                placeholder="(uid={{username}})"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Username Attr</Label>
                <Input
                  value={editForm.usernameAttribute}
                  onChange={(e) => setEditForm({ ...editForm, usernameAttribute: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email Attr</Label>
                <Input
                  value={editForm.emailAttribute}
                  onChange={(e) => setEditForm({ ...editForm, emailAttribute: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Display Name Attr</Label>
                <Input
                  value={editForm.displayNameAttribute}
                  onChange={(e) => setEditForm({ ...editForm, displayNameAttribute: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Group Search Base (optional)</Label>
              <Input
                value={editForm.groupSearchBase}
                onChange={(e) => setEditForm({ ...editForm, groupSearchBase: e.target.value })}
                placeholder="ou=groups"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Group Search Filter (optional)</Label>
              <Input
                value={editForm.groupSearchFilter}
                onChange={(e) => setEditForm({ ...editForm, groupSearchFilter: e.target.value })}
                placeholder="(objectClass=groupOfNames)"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Allow Web UI Login</Label>
              <Switch
                checked={editForm.allowLogin}
                onCheckedChange={(checked) => setEditForm({ ...editForm, allowLogin: checked })}
              />
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingConfig(null)}>Cancel</Button>
            <Button
              onClick={() => editMutation.mutate()}
              disabled={editMutation.isPending || !editForm.name || !editForm.host || !editForm.baseDn || !editForm.bindDn}
            >
              {editMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
