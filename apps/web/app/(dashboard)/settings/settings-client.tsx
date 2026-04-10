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
import { CheckCircle2, XCircle, Info, Database, Cpu, HardDrive, MemoryStick, Users } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { updateOrgName, saveLicenceKey, updateMetricRetention } from '@/lib/actions/settings'
import { getOrgDefaultCollectionSettings, updateOrgDefaultCollectionSettings } from '@/lib/actions/host-settings'
import type { Organisation, HostCollectionSettings } from '@/lib/db/schema'
import { DEFAULT_COLLECTION_SETTINGS } from '@/lib/db/schema'

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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
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
                    {RETENTION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            <form
              onSubmit={licenceForm.handleSubmit((v) => {
                setLicenceResult(null)
                licenceMutation.mutate(v)
              })}
              className="space-y-3"
            >
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
