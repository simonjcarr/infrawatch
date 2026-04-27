'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2, XCircle, Info, Database, Cpu, HardDrive, MemoryStick, Users, TerminalSquare, ScrollText, Bell, ScanLine, Tag as TagIcon, Copy, Check } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { updateOrgName, saveLicenceKey, updateMetricRetention, generateActivationToken } from '@/lib/actions/settings'
import { getOrgDefaultCollectionSettings, updateOrgDefaultCollectionSettings } from '@/lib/actions/host-settings'
import { getOrgTerminalSettings, updateOrgTerminalSettings } from '@/lib/actions/terminal'
import { getOrgNotificationSettings, updateOrgNotificationSettings } from '@/lib/actions/notification-settings'
import { getSoftwareInventorySettings, updateSoftwareInventorySettings } from '@/lib/actions/software-inventory'
import { getOrgDefaultTags, updateOrgDefaultTags } from '@/lib/actions/tags'
import { TagEditor, type EditorTag } from '@/components/shared/tag-editor'
import type { TagPair } from '@/lib/db/schema'
import type { OrgTerminalSettings } from '@/lib/actions/terminal'
import type { OrgNotificationSettingsFull } from '@/lib/actions/notification-settings'
import type { Organisation, HostCollectionSettings, SoftwareInventorySettings } from '@/lib/db/schema'
import { DEFAULT_COLLECTION_SETTINGS } from '@/lib/db/schema'
import { COMMUNITY_MAX_RETENTION_DAYS, hasFeature, type LicenceTier } from '@/lib/features'

const ALL_ROLES = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'org_admin', label: 'Org Admin' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'read_only', label: 'Read Only' },
]

const orgNameSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
})
type OrgNameValues = z.infer<typeof orgNameSchema>

const licenceSchema = z.object({
  key: z.string().min(1, 'Licence key is required'),
})
type LicenceValues = z.infer<typeof licenceSchema>

interface SettingsClientProps {
  org: Organisation
  isAdmin: boolean
}

function tierBadgeVariant(tier: string): 'outline' | 'default' | 'secondary' {
  if (tier === 'enterprise') return 'default'
  if (tier === 'pro') return 'secondary'
  return 'outline'
}

function formatTier(tier: string) {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
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

export function SettingsClient({ org, isAdmin }: SettingsClientProps) {
  const queryClient = useQueryClient()
  const tier = org.licenceTier as LicenceTier
  const canExtendRetention = hasFeature(tier, 'metricRetentionExtended')
  const [orgSaveSuccess, setOrgSaveSuccess] = useState(false)
  const [licenceResult, setLicenceResult] = useState<{
    success?: boolean
    tier?: string
    error?: string
  } | null>(null)
  const [retentionDays, setRetentionDays] = useState(String(org.metricRetentionDays ?? 30))
  const [retentionSaveSuccess, setRetentionSaveSuccess] = useState(false)
  const [retentionError, setRetentionError] = useState<string | null>(null)

  const orgForm = useForm<OrgNameValues>({
    resolver: zodResolver(orgNameSchema),
    defaultValues: { name: org.name },
  })

  const licenceForm = useForm<LicenceValues>({
    resolver: zodResolver(licenceSchema),
    defaultValues: { key: '' },
  })

  const orgMutation = useMutation({
    mutationFn: (values: OrgNameValues) => updateOrgName(org.id, values.name),
    onSuccess: (result) => {
      if ('error' in result) {
        orgForm.setError('name', { message: result.error })
        return
      }
      setOrgSaveSuccess(true)
      setTimeout(() => setOrgSaveSuccess(false), 3000)
    },
  })

  const licenceMutation = useMutation({
    mutationFn: (values: LicenceValues) => saveLicenceKey(org.id, values.key),
    onSuccess: (result) => {
      if ('error' in result) {
        setLicenceResult({ error: result.error })
        return
      }
      setLicenceResult({ success: true, tier: result.tier })
      licenceForm.reset()
    },
  })

  const [activationToken, setActivationToken] = useState<string | null>(null)
  const [activationError, setActivationError] = useState<string | null>(null)
  const [activationCopied, setActivationCopied] = useState(false)

  const activationMutation = useMutation({
    mutationFn: () => generateActivationToken(org.id),
    onSuccess: (result) => {
      if ('error' in result) {
        setActivationError(result.error)
        setActivationToken(null)
        return
      }
      setActivationError(null)
      setActivationToken(result.token)
      setActivationCopied(false)
    },
  })

  async function copyActivationToken() {
    if (!activationToken) return
    try {
      await navigator.clipboard.writeText(activationToken)
      setActivationCopied(true)
      setTimeout(() => setActivationCopied(false), 2000)
    } catch {
      setActivationError('Unable to copy — select the token and copy manually')
    }
  }

  const retentionMutation = useMutation({
    mutationFn: (days: number) => updateMetricRetention(org.id, days),
    onSuccess: (result) => {
      if ('error' in result) {
        setRetentionError(result.error)
        return
      }
      setRetentionSaveSuccess(true)
      setRetentionError(null)
      setTimeout(() => setRetentionSaveSuccess(false), 3000)
    },
  })

  // Default collection settings
  const [collectionSaveSuccess, setCollectionSaveSuccess] = useState(false)
  const { data: collectionDefaults } = useQuery({
    queryKey: ['org-collection-defaults', org.id],
    queryFn: () => getOrgDefaultCollectionSettings(org.id),
  })
  const [localCollectionSettings, setLocalCollectionSettings] = useState<HostCollectionSettings | null>(null)
  const currentCollectionSettings = localCollectionSettings ?? collectionDefaults ?? { ...DEFAULT_COLLECTION_SETTINGS }
  const collectionDirty = localCollectionSettings !== null

  const collectionMutation = useMutation({
    mutationFn: (settings: HostCollectionSettings) => updateOrgDefaultCollectionSettings(org.id, settings),
    onSuccess: (result) => {
      if ('error' in result) return
      setLocalCollectionSettings(null)
      setCollectionSaveSuccess(true)
      queryClient.invalidateQueries({ queryKey: ['org-collection-defaults', org.id] })
      setTimeout(() => setCollectionSaveSuccess(false), 3000)
    },
  })

  // Default tags
  const [tagsSaveSuccess, setTagsSaveSuccess] = useState(false)
  const { data: defaultTags } = useQuery({
    queryKey: ['org-default-tags', org.id],
    queryFn: () => getOrgDefaultTags(org.id),
  })
  const [localDefaultTags, setLocalDefaultTags] = useState<EditorTag[] | null>(null)
  const currentDefaultTags: EditorTag[] =
    localDefaultTags ?? (defaultTags ?? []).map((t) => ({ key: t.key, value: t.value }))
  const tagsDirty = localDefaultTags !== null

  const tagsMutation = useMutation({
    mutationFn: (pairs: TagPair[]) => updateOrgDefaultTags(org.id, pairs),
    onSuccess: (result) => {
      if ('error' in result) return
      setLocalDefaultTags(null)
      setTagsSaveSuccess(true)
      queryClient.invalidateQueries({ queryKey: ['org-default-tags', org.id] })
      setTimeout(() => setTagsSaveSuccess(false), 3000)
    },
  })

  // Terminal settings
  const [terminalSaveSuccess, setTerminalSaveSuccess] = useState(false)
  const { data: terminalDefaults } = useQuery({
    queryKey: ['org-terminal-settings', org.id],
    queryFn: () => getOrgTerminalSettings(org.id),
  })
  const [localTerminalSettings, setLocalTerminalSettings] = useState<OrgTerminalSettings | null>(null)
  const currentTerminalSettings = localTerminalSettings ?? terminalDefaults ?? { terminalEnabled: true, terminalLoggingEnabled: false, terminalDirectAccess: false }
  const terminalDirty = localTerminalSettings !== null

  const terminalMutation = useMutation({
    mutationFn: (settings: OrgTerminalSettings) => updateOrgTerminalSettings(org.id, settings),
    onSuccess: (result) => {
      if ('error' in result) return
      setLocalTerminalSettings(null)
      setTerminalSaveSuccess(true)
      queryClient.invalidateQueries({ queryKey: ['org-terminal-settings', org.id] })
      setTimeout(() => setTerminalSaveSuccess(false), 3000)
    },
  })

  // Notification settings
  const [notificationSaveSuccess, setNotificationSaveSuccess] = useState(false)
  const { data: notificationDefaults } = useQuery({
    queryKey: ['org-notification-settings', org.id],
    queryFn: () => getOrgNotificationSettings(org.id),
  })
  const [localNotificationSettings, setLocalNotificationSettings] = useState<OrgNotificationSettingsFull | null>(null)
  const currentNotificationSettings = localNotificationSettings ?? notificationDefaults ?? {
    inAppEnabled: true,
    inAppRoles: ['super_admin', 'org_admin', 'engineer'],
    allowUserOptOut: true,
  }
  const notificationDirty = localNotificationSettings !== null

  const notificationMutation = useMutation({
    mutationFn: (settings: OrgNotificationSettingsFull) => updateOrgNotificationSettings(org.id, settings),
    onSuccess: (result) => {
      if ('error' in result) return
      setLocalNotificationSettings(null)
      setNotificationSaveSuccess(true)
      queryClient.invalidateQueries({ queryKey: ['org-notification-settings', org.id] })
      setTimeout(() => setNotificationSaveSuccess(false), 3000)
    },
  })

  // Software inventory settings
  const [swInvSaveSuccess, setSwInvSaveSuccess] = useState(false)
  const { data: swInvDefaults } = useQuery({
    queryKey: ['org-software-inventory-settings', org.id],
    queryFn: () => getSoftwareInventorySettings(org.id),
  })
  const [localSwInvSettings, setLocalSwInvSettings] = useState<SoftwareInventorySettings | null>(null)
  const currentSwInvSettings = localSwInvSettings ?? swInvDefaults ?? { enabled: false, intervalHours: 24 }
  const swInvDirty = localSwInvSettings !== null

  const swInvMutation = useMutation({
    mutationFn: (settings: SoftwareInventorySettings) => updateSoftwareInventorySettings(org.id, settings),
    onSuccess: (result) => {
      if ('error' in result) return
      setLocalSwInvSettings(null)
      setSwInvSaveSuccess(true)
      queryClient.invalidateQueries({ queryKey: ['org-software-inventory-settings', org.id] })
      setTimeout(() => setSwInvSaveSuccess(false), 3000)
    },
  })

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1
          className="text-2xl font-semibold text-foreground"
          data-testid="settings-heading"
        >
          Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your organisation settings</p>
      </div>

      {!isAdmin && (
        <div className="flex items-start gap-3 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Info className="size-4 mt-0.5 shrink-0" />
          <span>These settings can only be edited by an organisation admin.</span>
        </div>
      )}

      {/* Organisation section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organisation</CardTitle>
          <CardDescription>
            {isAdmin
              ? "Update your organisation's display name"
              : "Your organisation's display name"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <form
              onSubmit={orgForm.handleSubmit((v) => orgMutation.mutate(v))}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="org-name">Organisation name</Label>
                <Input
                  id="org-name"
                  {...orgForm.register('name')}
                />
                {orgForm.formState.errors.name && (
                  <p className="text-xs text-destructive">
                    {orgForm.formState.errors.name.message}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" size="sm" disabled={orgMutation.isPending}>
                  {orgMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
                {orgSaveSuccess && (
                  <span className="flex items-center gap-1 text-sm text-green-700">
                    <CheckCircle2 className="size-4" />
                    Saved
                  </span>
                )}
              </div>
            </form>
          ) : (
            <p className="text-sm text-foreground">{org.name}</p>
          )}
        </CardContent>
      </Card>

      {/* Metric Retention section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            Metric Retention
          </CardTitle>
          <CardDescription>
            How long raw metric data is stored. Older data is automatically purged.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="retention-select">Retention period</Label>
                <Select
                  value={retentionDays}
                  onValueChange={setRetentionDays}
                  disabled={retentionMutation.isPending}
                >
                  <SelectTrigger id="retention-select" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETENTION_OPTIONS.map((opt) => {
                      const locked = !canExtendRetention && Number(opt.value) > COMMUNITY_MAX_RETENTION_DAYS
                      return (
                        <SelectItem key={opt.value} value={opt.value} disabled={locked}>
                          {opt.label}
                          {locked ? ' (Pro)' : ''}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                {!canExtendRetention && (
                  <p className="text-xs text-muted-foreground">
                    Retention above {COMMUNITY_MAX_RETENTION_DAYS} days requires a Pro or Enterprise licence.
                  </p>
                )}
              </div>
              {retentionError && (
                <p className="text-sm text-destructive">{retentionError}</p>
              )}
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  disabled={retentionMutation.isPending || retentionDays === String(org.metricRetentionDays ?? 30)}
                  onClick={() => retentionMutation.mutate(Number(retentionDays))}
                >
                  {retentionMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
                {retentionSaveSuccess && (
                  <span className="flex items-center gap-1 text-sm text-green-700">
                    <CheckCircle2 className="size-4" />
                    Saved
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-foreground">
              {RETENTION_OPTIONS.find((o) => o.value === String(org.metricRetentionDays ?? 30))?.label ?? `${org.metricRetentionDays ?? 30} days`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Default Data Collection section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="size-4 text-muted-foreground" />
            Default Data Collection
          </CardTitle>
          <CardDescription>
            These defaults are applied when new hosts are enrolled. Existing hosts are not affected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isAdmin ? (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Cpu className="size-4 text-muted-foreground" />
                  <Label className="text-sm">CPU Usage</Label>
                </div>
                <Switch
                  checked={currentCollectionSettings.cpu}
                  onCheckedChange={(checked) =>
                    setLocalCollectionSettings({ ...currentCollectionSettings, cpu: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MemoryStick className="size-4 text-muted-foreground" />
                  <Label className="text-sm">Memory Usage</Label>
                </div>
                <Switch
                  checked={currentCollectionSettings.memory}
                  onCheckedChange={(checked) =>
                    setLocalCollectionSettings({ ...currentCollectionSettings, memory: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <HardDrive className="size-4 text-muted-foreground" />
                  <Label className="text-sm">Disk Usage</Label>
                </div>
                <Switch
                  checked={currentCollectionSettings.disk}
                  onCheckedChange={(checked) =>
                    setLocalCollectionSettings({ ...currentCollectionSettings, disk: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Users className="size-4 text-muted-foreground" />
                  <Label className="text-sm">Local Users</Label>
                </div>
                <Switch
                  checked={currentCollectionSettings.localUsers}
                  onCheckedChange={(checked) =>
                    setLocalCollectionSettings({ ...currentCollectionSettings, localUsers: checked })
                  }
                />
              </div>
              <div className="flex items-center gap-3 pt-2 border-t">
                <Button
                  size="sm"
                  disabled={!collectionDirty || collectionMutation.isPending}
                  onClick={() => collectionMutation.mutate(currentCollectionSettings)}
                >
                  {collectionMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
                {collectionSaveSuccess && (
                  <span className="flex items-center gap-1 text-sm text-green-700">
                    <CheckCircle2 className="size-4" />
                    Saved
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2 text-sm">
              <p>CPU: {currentCollectionSettings.cpu ? 'Enabled' : 'Disabled'}</p>
              <p>Memory: {currentCollectionSettings.memory ? 'Enabled' : 'Disabled'}</p>
              <p>Disk: {currentCollectionSettings.disk ? 'Enabled' : 'Disabled'}</p>
              <p>Local Users: {currentCollectionSettings.localUsers ? 'Enabled' : 'Disabled'}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Default Tags section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TagIcon className="size-4 text-muted-foreground" />
            Default Tags
          </CardTitle>
          <CardDescription>
            Applied automatically to every newly approved host. Tags set per-host, on an enrolment
            token, or on the agent CLI override these defaults on matching keys.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TagEditor
            orgId={org.id}
            value={currentDefaultTags}
            onChange={(next) => setLocalDefaultTags(next)}
            disabled={!isAdmin}
          />
          {isAdmin && (
            <div className="flex items-center gap-3 pt-2 border-t">
              <Button
                size="sm"
                disabled={!tagsDirty || tagsMutation.isPending}
                onClick={() =>
                  tagsMutation.mutate(
                    currentDefaultTags.map((t) => ({ key: t.key, value: t.value })),
                  )
                }
              >
                {tagsMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              {tagsSaveSuccess && (
                <span className="flex items-center gap-1 text-sm text-green-700">
                  <CheckCircle2 className="size-4" />
                  Saved
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Terminal Access section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TerminalSquare className="size-4 text-muted-foreground" />
            Terminal Access
          </CardTitle>
          <CardDescription>
            Control interactive terminal access across all hosts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isAdmin ? (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <TerminalSquare className="size-4 text-muted-foreground" />
                  <div>
                    <Label className="text-sm">Enable Terminal Access</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      When disabled, no users can open terminal sessions on any host
                    </p>
                  </div>
                </div>
                <Switch
                  checked={currentTerminalSettings.terminalEnabled}
                  onCheckedChange={(checked) =>
                    setLocalTerminalSettings({
                      ...currentTerminalSettings,
                      terminalEnabled: checked,
                      terminalLoggingEnabled: checked ? currentTerminalSettings.terminalLoggingEnabled : false,
                    })
                  }
                />
              </div>
              {currentTerminalSettings.terminalEnabled && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ScrollText className="size-4 text-muted-foreground" />
                      <div>
                        <Label className="text-sm">Enable Session Logging</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Record terminal output for compliance. Input (passwords) is not recorded.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={currentTerminalSettings.terminalLoggingEnabled}
                      onCheckedChange={(checked) =>
                        setLocalTerminalSettings({ ...currentTerminalSettings, terminalLoggingEnabled: checked })
                      }
                    />
                  </div>
                </>
              )}
              <div className="flex items-center gap-3 pt-2 border-t">
                <Button
                  size="sm"
                  disabled={!terminalDirty || terminalMutation.isPending}
                  onClick={() => terminalMutation.mutate(currentTerminalSettings)}
                >
                  {terminalMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
                {terminalSaveSuccess && (
                  <span className="flex items-center gap-1 text-sm text-green-700">
                    <CheckCircle2 className="size-4" />
                    Saved
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2 text-sm">
              <p>Terminal Access: {currentTerminalSettings.terminalEnabled ? 'Enabled' : 'Disabled'}</p>
              {currentTerminalSettings.terminalEnabled && (
                <>
                  <p>Session Logging: {currentTerminalSettings.terminalLoggingEnabled ? 'Enabled' : 'Disabled'}</p>
                  <p>Host Authentication: SSH username and password required</p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notification Settings section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground" />
            Notification Settings
          </CardTitle>
          <CardDescription>
            Control in-app notifications and which roles receive them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isAdmin ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Enable In-App Notifications</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When enabled, alert events appear in the notification bell for eligible users
                  </p>
                </div>
                <Switch
                  checked={currentNotificationSettings.inAppEnabled}
                  onCheckedChange={(checked) =>
                    setLocalNotificationSettings({
                      ...currentNotificationSettings,
                      inAppEnabled: checked,
                    })
                  }
                />
              </div>
              {currentNotificationSettings.inAppEnabled && (
                <>
                  <div className="space-y-2">
                    <Label className="text-sm">Roles that receive notifications</Label>
                    <p className="text-xs text-muted-foreground">
                      Select which roles get in-app notifications when alerts fire or resolve
                    </p>
                    <div className="space-y-2 pt-1">
                      {ALL_ROLES.map((role) => (
                        <div key={role.value} className="flex items-center gap-2">
                          <Checkbox
                            id={`role-${role.value}`}
                            checked={currentNotificationSettings.inAppRoles.includes(role.value)}
                            onCheckedChange={(checked) => {
                              const roles = checked
                                ? [...currentNotificationSettings.inAppRoles, role.value]
                                : currentNotificationSettings.inAppRoles.filter((r) => r !== role.value)
                              setLocalNotificationSettings({
                                ...currentNotificationSettings,
                                inAppRoles: roles,
                              })
                            }}
                          />
                          <Label htmlFor={`role-${role.value}`} className="text-sm font-normal cursor-pointer">
                            {role.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Allow users to opt out</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        When enabled, users can turn off their own in-app notifications in their profile
                      </p>
                    </div>
                    <Switch
                      checked={currentNotificationSettings.allowUserOptOut}
                      onCheckedChange={(checked) =>
                        setLocalNotificationSettings({
                          ...currentNotificationSettings,
                          allowUserOptOut: checked,
                        })
                      }
                    />
                  </div>
                </>
              )}
              <div className="flex items-center gap-3 pt-2 border-t">
                <Button
                  size="sm"
                  disabled={!notificationDirty || notificationMutation.isPending}
                  onClick={() => notificationMutation.mutate(currentNotificationSettings)}
                >
                  {notificationMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
                {notificationSaveSuccess && (
                  <span className="flex items-center gap-1 text-sm text-green-700">
                    <CheckCircle2 className="size-4" />
                    Saved
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2 text-sm">
              <p>In-App Notifications: {currentNotificationSettings.inAppEnabled ? 'Enabled' : 'Disabled'}</p>
              {currentNotificationSettings.inAppEnabled && (
                <>
                  <p>Receiving roles: {currentNotificationSettings.inAppRoles.join(', ')}</p>
                  <p>User opt-out: {currentNotificationSettings.allowUserOptOut ? 'Allowed' : 'Not allowed'}</p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Software Inventory section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScanLine className="size-4 text-muted-foreground" />
            Software Inventory
          </CardTitle>
          <CardDescription>
            Automatically scan hosts for installed packages. Results appear on each host&apos;s Inventory tab and the global Installed Software report.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isAdmin ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Enable software inventory scanning</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Agents will scan installed packages at the configured interval
                  </p>
                </div>
                <Switch
                  checked={currentSwInvSettings.enabled}
                  onCheckedChange={(checked) =>
                    setLocalSwInvSettings({ ...currentSwInvSettings, enabled: checked })
                  }
                />
              </div>
              {currentSwInvSettings.enabled && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="sw-inv-interval" className="text-sm">
                      Scan interval (hours)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      How often each host is scanned. Min 1 hour, max 720 hours (30 days).
                    </p>
                    <Input
                      id="sw-inv-interval"
                      type="number"
                      min={1}
                      max={720}
                      className="w-32"
                      value={currentSwInvSettings.intervalHours}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10)
                        if (!isNaN(n)) {
                          setLocalSwInvSettings({ ...currentSwInvSettings, intervalHours: n })
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Additional package sources</Label>
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="sw-inv-snap"
                          checked={currentSwInvSettings.includeSnapFlatpak ?? false}
                          onCheckedChange={(checked) =>
                            setLocalSwInvSettings({
                              ...currentSwInvSettings,
                              includeSnapFlatpak: !!checked,
                            })
                          }
                        />
                        <Label htmlFor="sw-inv-snap" className="text-sm font-normal cursor-pointer">
                          Include Snap and Flatpak packages (Linux)
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="sw-inv-winstore"
                          checked={currentSwInvSettings.includeWindowsStore ?? false}
                          onCheckedChange={(checked) =>
                            setLocalSwInvSettings({
                              ...currentSwInvSettings,
                              includeWindowsStore: !!checked,
                            })
                          }
                        />
                        <Label htmlFor="sw-inv-winstore" className="text-sm font-normal cursor-pointer">
                          Include Windows Store apps
                        </Label>
                      </div>
                    </div>
                  </div>
                </>
              )}
              <div className="flex items-center gap-3 pt-2 border-t">
                <Button
                  size="sm"
                  disabled={!swInvDirty || swInvMutation.isPending}
                  onClick={() => swInvMutation.mutate(currentSwInvSettings)}
                >
                  {swInvMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
                {swInvSaveSuccess && (
                  <span className="flex items-center gap-1 text-sm text-green-700">
                    <CheckCircle2 className="size-4" />
                    Saved
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2 text-sm text-foreground">
              <p>Software scanning: {currentSwInvSettings.enabled ? 'Enabled' : 'Disabled'}</p>
              {currentSwInvSettings.enabled && (
                <p>Scan interval: every {currentSwInvSettings.intervalHours} hour{currentSwInvSettings.intervalHours === 1 ? '' : 's'}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Licence section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Licence</CardTitle>
          <CardDescription>
            {isAdmin
              ? 'Enter a licence key to unlock Pro or Enterprise features'
              : 'Your organisation licence'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Current tier:</span>
            <Badge variant={tierBadgeVariant(org.licenceTier)}>
              {formatTier(org.licenceTier)}
            </Badge>
          </div>

          {isAdmin && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Step 1 — Generate an activation token</p>
                <p className="text-xs text-muted-foreground">
                  Generate a token here and paste it into the checkout at{' '}
                  <span className="font-mono">licence.carrtech.dev</span>. The resulting
                  licence key is bound to this install and cannot be used on another.
                </p>
              </div>

              {activationToken ? (
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <code
                      className="flex-1 rounded border bg-background px-2 py-1.5 text-xs break-all font-mono text-foreground"
                      data-testid="activation-token"
                    >
                      {activationToken}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={copyActivationToken}
                      className="shrink-0"
                    >
                      {activationCopied ? (
                        <>
                          <Check className="size-4" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-4" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Valid for 30 days. Generate a new one at any time — previous tokens remain valid until they expire.
                  </p>
                </div>
              ) : null}

              {activationError ? (
                <p className="text-xs text-destructive">{activationError}</p>
              ) : null}

              <Button
                type="button"
                size="sm"
                variant={activationToken ? 'outline' : 'default'}
                onClick={() => activationMutation.mutate()}
                disabled={activationMutation.isPending}
                data-testid="activation-token-generate"
              >
                {activationMutation.isPending
                  ? 'Generating…'
                  : activationToken
                    ? 'Generate a new token'
                    : 'Generate activation token'}
              </Button>
            </div>
          )}

          {isAdmin && (
            <form
              onSubmit={licenceForm.handleSubmit((v) => {
                setLicenceResult(null)
                licenceMutation.mutate(v)
              })}
              className="space-y-3"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Step 2 — Paste the returned licence key</p>
                <p className="text-xs text-muted-foreground">
                  After completing checkout, the licence key is emailed to your technical contact
                  and shown in the licence purchase dashboard. Paste it here to activate Pro or Enterprise features.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="licence-key">Licence key</Label>
                <Input
                  id="licence-key"
                  placeholder="Paste your licence key here"
                  {...licenceForm.register('key')}
                />
                {licenceForm.formState.errors.key && (
                  <p className="text-xs text-destructive">
                    {licenceForm.formState.errors.key.message}
                  </p>
                )}
              </div>

              {licenceResult && (
                <div
                  className={`flex items-start gap-2 text-sm rounded-md p-3 ${
                    licenceResult.success
                      ? 'bg-green-50 text-green-800 border border-green-200'
                      : 'bg-destructive/10 text-destructive border border-destructive/20'
                  }`}
                >
                  {licenceResult.success ? (
                    <>
                      <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
                      <span>
                        Licence activated — tier upgraded to{' '}
                        <strong>{formatTier(licenceResult.tier ?? '')}</strong>
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="size-4 mt-0.5 shrink-0" />
                      <span>{licenceResult.error}</span>
                    </>
                  )}
                </div>
              )}

              <Button type="submit" size="sm" disabled={licenceMutation.isPending}>
                {licenceMutation.isPending ? 'Validating…' : 'Validate & save'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
