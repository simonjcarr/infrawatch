'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, KeyRound, Settings, Users, Cpu, HardDrive, MemoryStick, Plus, X, TerminalSquare, Tag as TagIcon, Boxes } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle2 } from 'lucide-react'
import {
  getHostCollectionSettings,
  getHostDockerRetentionSettings,
  updateHostCollectionSettings,
  updateHostDockerRetentionOverride,
} from '@/lib/actions/host-settings'
import { getHostTerminalSettings, trustPendingSshHostKeys, updateHostTerminalSettings } from '@/lib/actions/terminal'
import type { HostTerminalSettings } from '@/lib/actions/terminal-core'
import { getInstanceUsers } from '@/lib/actions/users'
import { listResourceTags, replaceResourceTags } from '@/lib/actions/tags'
import type { HostCollectionSettings } from '@/lib/db/schema'
import { TagEditor, type EditorTag } from '@/components/shared/tag-editor'

interface SettingsTabProps {
  hostId: string
  isAdmin: boolean
}

const RETENTION_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
]

export function SettingsTab({ hostId, isAdmin }: SettingsTabProps) {
  const queryClient = useQueryClient()
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [dockerRetentionSaveSuccess, setDockerRetentionSaveSuccess] = useState(false)
  const [localDockerRetentionOverride, setLocalDockerRetentionOverride] = useState<number | null | undefined>(undefined)

  // Terminal settings state
  const [terminalSaveSuccess, setTerminalSaveSuccess] = useState(false)
  const [newAllowedUser, setNewAllowedUser] = useState('')

  const { data: settings, isLoading } = useQuery({
    queryKey: ['host-collection-settings', hostId],
    queryFn: () => getHostCollectionSettings(hostId),
  })

  const { data: terminalSettings } = useQuery({
    queryKey: ['host-terminal-settings', hostId],
    queryFn: () => getHostTerminalSettings(hostId),
  })

  const { data: dockerRetentionSettings } = useQuery({
    queryKey: ['host-docker-retention-settings', hostId],
    queryFn: () => getHostDockerRetentionSettings(hostId),
  })

  const { data: instanceUsers } = useQuery({
    queryKey: ['instance-users'],
    queryFn: () => getInstanceUsers(),
    enabled: isAdmin,
  })

  const [localTerminalSettings, setLocalTerminalSettings] = useState<HostTerminalSettings | null>(null)
  const currentTerminalSettings = localTerminalSettings ?? terminalSettings

  const terminalMutation = useMutation({
    mutationFn: (s: HostTerminalSettings) => updateHostTerminalSettings(hostId, s),
    onSuccess: (result) => {
      if ('error' in result) return
      setTerminalSaveSuccess(true)
      setLocalTerminalSettings(null)
      queryClient.invalidateQueries({ queryKey: ['host-terminal-settings', hostId] })
      setTimeout(() => setTerminalSaveSuccess(false), 3000)
    },
  })

  const trustSshHostKeyMutation = useMutation({
    mutationFn: () => trustPendingSshHostKeys(hostId),
    onSuccess: (result) => {
      if ('error' in result) return
      queryClient.invalidateQueries({ queryKey: ['host-terminal-settings', hostId] })
    },
  })

  function updateTerminalSetting(patch: Partial<HostTerminalSettings>) {
    const base = currentTerminalSettings ?? {
      terminalEnabled: true,
      terminalAllowedUsers: [],
      sshHostKeys: [],
      pendingSshHostKeys: [],
    }
    setLocalTerminalSettings({ ...base, ...patch })
  }

  function addAllowedUser(userId: string) {
    if (!currentTerminalSettings) return
    const existing = currentTerminalSettings.terminalAllowedUsers ?? []
    if (existing.includes(userId)) return
    updateTerminalSetting({ terminalAllowedUsers: [...existing, userId] })
    setNewAllowedUser('')
  }

  function removeAllowedUser(userId: string) {
    if (!currentTerminalSettings) return
    updateTerminalSetting({
      terminalAllowedUsers: (currentTerminalSettings.terminalAllowedUsers ?? []).filter((id) => id !== userId),
    })
  }

  // Tags state
  const [tagSaveSuccess, setTagSaveSuccess] = useState(false)
  const [localTags, setLocalTags] = useState<EditorTag[] | null>(null)

  const { data: hostTags } = useQuery({
    queryKey: ['host-tags', hostId],
    queryFn: () => listResourceTags('host', hostId),
  })
  const currentTags: EditorTag[] =
    localTags ?? (hostTags ?? []).map((t) => ({ id: t.resourceTagId, key: t.key, value: t.value }))
  const trustSshHostKeyError =
    trustSshHostKeyMutation.data && 'error' in trustSshHostKeyMutation.data
      ? trustSshHostKeyMutation.data.error
      : null

  const tagMutation = useMutation({
    mutationFn: (pairs: EditorTag[]) =>
      replaceResourceTags(
        'host',
        hostId,
        pairs.map((t) => ({ key: t.key, value: t.value })),
      ),
    onSuccess: (result) => {
      if ('error' in result) return
      setTagSaveSuccess(true)
      setLocalTags(null)
      queryClient.invalidateQueries({ queryKey: ['host-tags', hostId] })
      setTimeout(() => setTagSaveSuccess(false), 3000)
    },
  })

  const [localSettings, setLocalSettings] = useState<HostCollectionSettings | null>(null)

  // Use local state if user has made changes, otherwise use fetched data
  const currentSettings = localSettings ?? settings

  const mutation = useMutation({
    mutationFn: (s: HostCollectionSettings) => updateHostCollectionSettings(hostId, s),
    onSuccess: (result) => {
      if ('error' in result) return
      setSaveSuccess(true)
      setLocalSettings(null)
      queryClient.invalidateQueries({ queryKey: ['host-collection-settings', hostId] })
      setTimeout(() => setSaveSuccess(false), 3000)
    },
  })

  const dockerRetentionMutation = useMutation({
    mutationFn: (days: number | null) => updateHostDockerRetentionOverride(hostId, days),
    onSuccess: (result) => {
      if ('error' in result) return
      setDockerRetentionSaveSuccess(true)
      setLocalDockerRetentionOverride(undefined)
      queryClient.invalidateQueries({ queryKey: ['host-docker-retention-settings', hostId] })
      setTimeout(() => setDockerRetentionSaveSuccess(false), 3000)
    },
  })

  function updateSetting(patch: Partial<HostCollectionSettings>) {
    const base = currentSettings ?? { cpu: true, memory: true, disk: true, localUsers: false }
    setLocalSettings({ ...base, ...patch })
  }

  function addUsername() {
    const trimmed = newUsername.trim()
    if (!trimmed || !currentSettings) return
    const existing = currentSettings.localUserConfig?.selectedUsernames ?? []
    if (existing.includes(trimmed)) return
    updateSetting({
      localUserConfig: {
        mode: 'selected',
        selectedUsernames: [...existing, trimmed],
      },
    })
    setNewUsername('')
  }

  function removeUsername(username: string) {
    if (!currentSettings) return
    const existing = currentSettings.localUserConfig?.selectedUsernames ?? []
    updateSetting({
      localUserConfig: {
        mode: 'selected',
        selectedUsernames: existing.filter((u) => u !== username),
      },
    })
  }

  if (isLoading || !currentSettings) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          Loading settings...
        </CardContent>
      </Card>
    )
  }

  const isDirty = localSettings !== null
  const currentDockerRetentionOverride =
    localDockerRetentionOverride === undefined
      ? dockerRetentionSettings?.retentionDaysOverride ?? null
      : localDockerRetentionOverride
  const dockerRetentionValue = currentDockerRetentionOverride === null ? 'inherit' : String(currentDockerRetentionOverride)
  const dockerRetentionDirty =
    localDockerRetentionOverride !== undefined &&
    localDockerRetentionOverride !== (dockerRetentionSettings?.retentionDaysOverride ?? null)
  const effectiveDockerRetentionDays =
    currentDockerRetentionOverride ?? dockerRetentionSettings?.globalRetentionDays ?? 30

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="size-4 text-muted-foreground" />
            Data Collection
          </CardTitle>
          <CardDescription>
            Choose what data this host collects and reports. Changes take effect on the next agent heartbeat.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* CPU */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Cpu className="size-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">CPU Usage</Label>
                <p className="text-xs text-muted-foreground">Monitor CPU utilisation percentage</p>
              </div>
            </div>
            <Switch
              checked={currentSettings.cpu}
              onCheckedChange={(checked) => updateSetting({ cpu: checked })}
            />
          </div>

          {/* Memory */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MemoryStick className="size-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">Memory Usage</Label>
                <p className="text-xs text-muted-foreground">Monitor memory utilisation percentage</p>
              </div>
            </div>
            <Switch
              checked={currentSettings.memory}
              onCheckedChange={(checked) => updateSetting({ memory: checked })}
            />
          </div>

          {/* Disk */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <HardDrive className="size-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">Disk Usage</Label>
                <p className="text-xs text-muted-foreground">Monitor disk space utilisation</p>
              </div>
            </div>
            <Switch
              checked={currentSettings.disk}
              onCheckedChange={(checked) => updateSetting({ disk: checked })}
            />
          </div>

          {/* Local Users */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Users className="size-4 text-muted-foreground" />
                <div>
                  <Label className="text-sm font-medium">Local Users</Label>
                  <p className="text-xs text-muted-foreground">
                    Discover and monitor local OS user accounts and SSH keys
                  </p>
                </div>
              </div>
              <Switch
                checked={currentSettings.localUsers}
                onCheckedChange={(checked) =>
                  updateSetting({
                    localUsers: checked,
                    localUserConfig: checked
                      ? currentSettings.localUserConfig ?? { mode: 'all' }
                      : undefined,
                  })
                }
              />
            </div>

            {/* Local Users sub-settings */}
            {currentSettings.localUsers && (
              <div className="ml-7 pl-4 border-l-2 border-muted space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Monitoring Mode</Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="localUserMode"
                        checked={currentSettings.localUserConfig?.mode !== 'selected'}
                        onChange={() =>
                          updateSetting({
                            localUserConfig: { mode: 'all' },
                          })
                        }
                        className="accent-primary"
                      />
                      Monitor all users
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="localUserMode"
                        checked={currentSettings.localUserConfig?.mode === 'selected'}
                        onChange={() =>
                          updateSetting({
                            localUserConfig: {
                              mode: 'selected',
                              selectedUsernames:
                                currentSettings.localUserConfig?.selectedUsernames ?? [],
                            },
                          })
                        }
                        className="accent-primary"
                      />
                      Monitor specific users
                    </label>
                  </div>
                </div>

                {currentSettings.localUserConfig?.mode === 'selected' && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Input
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        placeholder="Enter username"
                        className="max-w-xs"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addUsername()
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addUsername}
                        disabled={!newUsername.trim()}
                      >
                        <Plus className="size-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(currentSettings.localUserConfig.selectedUsernames ?? []).map((username) => (
                        <span
                          key={username}
                          className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-sm font-mono"
                        >
                          {username}
                          <button
                            onClick={() => removeUsername(username)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                      {(currentSettings.localUserConfig.selectedUsernames ?? []).length === 0 && (
                        <p className="text-sm text-muted-foreground">No users added yet.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2 border-t">
            <Button
              size="sm"
              disabled={!isDirty || mutation.isPending}
              onClick={() => mutation.mutate(currentSettings)}
            >
              {mutation.isPending ? 'Saving...' : 'Save'}
            </Button>
            {saveSuccess && (
              <span className="flex items-center gap-1 text-sm text-green-700">
                <CheckCircle2 className="size-4" />
                Saved
              </span>
            )}
            {mutation.isError && (
              <span className="text-sm text-destructive">Failed to save settings</span>
            )}
          </div>
        </CardContent>
      </Card>

      {dockerRetentionSettings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Boxes className="size-4 text-muted-foreground" />
              Docker Retention
            </CardTitle>
            <CardDescription>
              Override how long Docker container metrics are kept for this host.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Inherited default</p>
                <p className="text-sm font-medium" data-testid="settings-docker-retention-inherited">
                  {dockerRetentionSettings.globalRetentionDays} days
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Host override</p>
                <p className="text-sm font-medium">
                  {currentDockerRetentionOverride === null ? 'None' : `${currentDockerRetentionOverride} days`}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Effective retention</p>
                <p className="text-sm font-medium">{effectiveDockerRetentionDays} days</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="docker-retention-override-select">Retention override</Label>
              <Select
                value={dockerRetentionValue}
                onValueChange={(value) =>
                  setLocalDockerRetentionOverride(value === 'inherit' ? null : Number(value))
                }
                disabled={dockerRetentionMutation.isPending}
              >
                <SelectTrigger
                  id="docker-retention-override-select"
                  className="w-56"
                  data-testid="settings-docker-retention-override-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit default</SelectItem>
                  {RETENTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 pt-2 border-t">
              <Button
                size="sm"
                disabled={!dockerRetentionDirty || dockerRetentionMutation.isPending}
                onClick={() => dockerRetentionMutation.mutate(currentDockerRetentionOverride)}
                data-testid="settings-docker-retention-save"
              >
                {dockerRetentionMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={currentDockerRetentionOverride === null || dockerRetentionMutation.isPending}
                onClick={() => dockerRetentionMutation.mutate(null)}
                data-testid="settings-docker-retention-clear"
              >
                Clear override
              </Button>
              {dockerRetentionSaveSuccess && (
                <span className="flex items-center gap-1 text-sm text-green-700" data-testid="settings-docker-retention-success">
                  <CheckCircle2 className="size-4" />
                  Saved
                </span>
              )}
              {dockerRetentionMutation.isError && (
                <span className="text-sm text-destructive">Failed to save Docker retention</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tags Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TagIcon className="size-4 text-muted-foreground" />
            Tags
          </CardTitle>
          <CardDescription>
            Tags group hosts for filtering, alerting and bulk operations. Start typing to pick
            from existing tags — this keeps naming consistent across the fleet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TagEditor
            value={currentTags}
            onChange={setLocalTags}
            disabled={!isAdmin}
          />
          {isAdmin && (
            <div className="mt-4 flex items-center gap-3 border-t pt-4">
              <Button
                size="sm"
                disabled={localTags === null || tagMutation.isPending}
                onClick={() => tagMutation.mutate(currentTags)}
              >
                {tagMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              {tagSaveSuccess && (
                <span className="flex items-center gap-1 text-sm text-green-700">
                  <CheckCircle2 className="size-4" />
                  Saved
                </span>
              )}
              {tagMutation.isError && (
                <span className="text-sm text-destructive">Failed to save tags</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Terminal Access Card */}
      {isAdmin && currentTerminalSettings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TerminalSquare className="size-4 text-muted-foreground" />
              Terminal Access
            </CardTitle>
            <CardDescription>
              Control terminal access for this host. These settings override the global instance setting.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Enable/disable terminal */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Enable Terminal</Label>
                <p className="text-xs text-muted-foreground">Allow users to open a terminal session on this host</p>
              </div>
              <Switch
                checked={currentTerminalSettings.terminalEnabled}
                onCheckedChange={(checked) => updateTerminalSetting({ terminalEnabled: checked })}
              />
            </div>

            {/* User allowlist */}
            {currentTerminalSettings.terminalEnabled && (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Allowed Users</Label>
                  <p className="text-xs text-muted-foreground">
                    Restrict terminal access to specific users. Leave empty to allow all users with sufficient role.
                  </p>
                </div>

                {/* User select */}
                {instanceUsers && (
                  <div className="flex gap-2">
                    <select
                      value={newAllowedUser}
                      onChange={(e) => setNewAllowedUser(e.target.value)}
                      className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-w-xs"
                    >
                      <option value="">Select a user...</option>
                      {instanceUsers.members
                        .filter((u) => !(currentTerminalSettings.terminalAllowedUsers ?? []).includes(u.id))
                        .filter((u) => u.role !== 'agent')
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.email})
                          </option>
                        ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => newAllowedUser && addAllowedUser(newAllowedUser)}
                      disabled={!newAllowedUser}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                )}

                {/* Current allowlist */}
                <div className="flex flex-wrap gap-2">
                  {(currentTerminalSettings.terminalAllowedUsers ?? []).map((userId) => {
                    const user = instanceUsers?.members.find((u) => u.id === userId)
                    return (
                      <span
                        key={userId}
                        className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-sm"
                      >
                        {user ? `${user.name} (${user.email})` : userId}
                        <button
                          onClick={() => removeAllowedUser(userId)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    )
                  })}
                  {(currentTerminalSettings.terminalAllowedUsers ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">No restrictions — all eligible users can access.</p>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" />
                <Label className="text-sm font-medium">SSH Host Keys</Label>
              </div>
              {currentTerminalSettings.sshHostKeys.length > 0 ? (
                <div className="space-y-1">
                  {currentTerminalSettings.sshHostKeys.map((key) => (
                    <code
                      key={`${key.algorithm ?? 'unknown'}:${key.fingerprintSha256}`}
                      className="block overflow-hidden text-ellipsis rounded bg-muted px-2 py-1 text-xs"
                      title={`${key.algorithm ?? 'unknown'} ${key.fingerprintSha256}`}
                    >
                      {key.algorithm ? `${key.algorithm} ` : ''}
                      {key.fingerprintSha256}
                    </code>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No SSH host key has been reported by the agent yet.
                </p>
              )}

              {currentTerminalSettings.sshHostKeyStatus === 'changed' &&
                currentTerminalSettings.pendingSshHostKeys.length > 0 && (
                  <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium">SSH host key changed</p>
                        <p className="text-xs">
                          Terminal sessions will stay blocked until an admin verifies and trusts the newly observed key.
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {currentTerminalSettings.pendingSshHostKeys.map((key) => (
                        <code
                          key={`${key.algorithm ?? 'unknown'}:${key.fingerprintSha256}`}
                          className="block overflow-hidden text-ellipsis rounded bg-white/70 px-2 py-1 text-xs"
                          title={`${key.algorithm ?? 'unknown'} ${key.fingerprintSha256}`}
                        >
                          {key.algorithm ? `${key.algorithm} ` : ''}
                          {key.fingerprintSha256}
                        </code>
                      ))}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={trustSshHostKeyMutation.isPending}
                      onClick={() => trustSshHostKeyMutation.mutate()}
                    >
                      {trustSshHostKeyMutation.isPending ? 'Trusting...' : 'Trust new SSH host key'}
                    </Button>
                    {trustSshHostKeyError && <p className="text-xs text-destructive">{trustSshHostKeyError}</p>}
                  </div>
                )}
            </div>

            {/* Terminal Save */}
            <div className="flex items-center gap-3 pt-2 border-t">
              <Button
                size="sm"
                disabled={localTerminalSettings === null || terminalMutation.isPending}
                onClick={() => currentTerminalSettings && terminalMutation.mutate(currentTerminalSettings)}
              >
                {terminalMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              {terminalSaveSuccess && (
                <span className="flex items-center gap-1 text-sm text-green-700">
                  <CheckCircle2 className="size-4" />
                  Saved
                </span>
              )}
              {terminalMutation.isError && (
                <span className="text-sm text-destructive">Failed to save settings</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
