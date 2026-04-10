'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, Users, Cpu, HardDrive, MemoryStick, Plus, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CheckCircle2 } from 'lucide-react'
import { getHostCollectionSettings, updateHostCollectionSettings } from '@/lib/actions/host-settings'
import type { HostCollectionSettings } from '@/lib/db/schema'

interface SettingsTabProps {
  orgId: string
  hostId: string
}

export function SettingsTab({ orgId, hostId }: SettingsTabProps) {
  const queryClient = useQueryClient()
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [newUsername, setNewUsername] = useState('')

  const { data: settings, isLoading } = useQuery({
    queryKey: ['host-collection-settings', orgId, hostId],
    queryFn: () => getHostCollectionSettings(orgId, hostId),
  })

  const [localSettings, setLocalSettings] = useState<HostCollectionSettings | null>(null)

  // Use local state if user has made changes, otherwise use fetched data
  const currentSettings = localSettings ?? settings

  const mutation = useMutation({
    mutationFn: (s: HostCollectionSettings) => updateHostCollectionSettings(orgId, hostId, s),
    onSuccess: (result) => {
      if ('error' in result) return
      setSaveSuccess(true)
      setLocalSettings(null)
      queryClient.invalidateQueries({ queryKey: ['host-collection-settings', orgId, hostId] })
      setTimeout(() => setSaveSuccess(false), 3000)
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
    </div>
  )
}
