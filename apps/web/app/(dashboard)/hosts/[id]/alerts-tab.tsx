'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import { Bell, Plus, Trash2, VolumeX, VolumeOff } from 'lucide-react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  getAlertInstances,
  getActiveSilencesForHost,
  createSilence,
  deleteSilence,
} from '@/lib/actions/alerts'
import { getChecksWithHistory } from '@/lib/actions/checks'
import { getCertificates } from '@/lib/actions/certificates'
import type { AlertRule, AlertSeverity, AlertSilence } from '@/lib/db/schema'

// ─── Form schema (flat — validation applied per conditionType in onSubmit) ─────

const ruleFormSchema = z.object({
  conditionType: z.enum(['check_status', 'metric_threshold', 'cert_expiry']),
  name: z.string().min(1, 'Name is required').max(100),
  severity: z.enum(['info', 'warning', 'critical']),
  // check_status fields
  checkId: z.string().optional(),
  failureThreshold: z.number().int().min(1).max(10).optional(),
  // metric_threshold fields
  metric: z.enum(['cpu', 'memory', 'disk']).optional(),
  operator: z.enum(['gt', 'lt']).optional(),
  threshold: z.number().min(0).max(100).optional(),
  // cert_expiry fields
  certScope: z.enum(['all', 'specific']).optional(),
  certificateId: z.string().optional(),
  daysBeforeExpiry: z.number().int().min(1).max(365).optional(),
})

type RuleFormValues = z.infer<typeof ruleFormSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  switch (severity) {
    case 'critical':
      return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">Critical</Badge>
    case 'warning':
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">Warning</Badge>
    case 'info':
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">Info</Badge>
  }
}

function ruleConditionSummary(rule: AlertRule): string {
  const cfg = rule.config as unknown as Record<string, unknown>
  if (rule.conditionType === 'check_status') {
    return `Check fails ${cfg['failureThreshold'] ?? 1}× consecutively`
  }
  if (rule.conditionType === 'metric_threshold') {
    const op = cfg['operator'] === 'gt' ? '>' : '<'
    return `${cfg['metric']} ${op} ${cfg['threshold']}%`
  }
  if (rule.conditionType === 'cert_expiry') {
    const scope = cfg['scope'] === 'specific' ? 'specific cert' : 'any cert'
    return `${scope} expires within ${cfg['daysBeforeExpiry'] ?? 30} days`
  }
  return '—'
}

// ─── Silence Dialog (host-scoped) ─────────────────────────────────────────────

function toLocalDatetimeValue(d: Date): string {
  const offset = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - offset).toISOString().slice(0, 16)
}

const silenceFormSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(255),
  startsAt: z.string().min(1, 'Start time is required'),
  endsAt: z.string().min(1, 'End time is required'),
})

type SilenceFormValues = z.infer<typeof silenceFormSchema>

function AddSilenceDialog({
  orgId,
  hostId,
  userId,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string
  hostId: string
  userId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SilenceFormValues>({
    resolver: zodResolver(silenceFormSchema),
    defaultValues: {
      startsAt: toLocalDatetimeValue(now),
      endsAt: toLocalDatetimeValue(inOneHour),
    },
  })

  async function onSubmit(values: SilenceFormValues) {
    const result = await createSilence(orgId, userId, {
      hostId,
      reason: values.reason,
      startsAt: new Date(values.startsAt).toISOString(),
      endsAt: new Date(values.endsAt).toISOString(),
    })
    if ('error' in result) return
    reset()
    onSuccess()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Silence for This Host</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="silence-reason">Reason</Label>
            <Input
              id="silence-reason"
              placeholder="e.g. Scheduled maintenance window"
              {...register('reason')}
            />
            {errors.reason && <p className="text-sm text-red-600">{errors.reason.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="silence-starts">Starts at</Label>
              <Input id="silence-starts" type="datetime-local" {...register('startsAt')} />
              {errors.startsAt && <p className="text-sm text-red-600">{errors.startsAt.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="silence-ends">Ends at</Label>
              <Input id="silence-ends" type="datetime-local" {...register('endsAt')} />
              {errors.endsAt && <p className="text-sm text-red-600">{errors.endsAt.message}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Create Silence
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Add Rule Dialog ──────────────────────────────────────────────────────────

function AddRuleDialog({
  orgId,
  hostId,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string
  hostId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
  const [conditionType, setConditionType] = useState<'check_status' | 'metric_threshold' | 'cert_expiry'>('check_status')
  const [certScope, setCertScope] = useState<'all' | 'specific'>('all')

  const { data: checks = [] } = useQuery({
    queryKey: ['checks-history', orgId, hostId],
    queryFn: () => getChecksWithHistory(orgId, hostId),
  })

  const { data: orgCerts = [] } = useQuery({
    queryKey: ['certificates', orgId],
    queryFn: () => getCertificates(orgId, { limit: 200 }),
    enabled: conditionType === 'cert_expiry' && certScope === 'specific',
  })

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RuleFormValues>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: {
      conditionType: 'check_status',
      name: '',
      checkId: '',
      failureThreshold: 3,
      severity: 'warning',
    },
  })

  async function onSubmit(values: RuleFormValues) {
    let input: Parameters<typeof createAlertRule>[1]

    if (values.conditionType === 'check_status') {
      if (!values.checkId) return
      input = {
        hostId,
        name: values.name,
        conditionType: 'check_status',
        config: { checkId: values.checkId, failureThreshold: values.failureThreshold ?? 3 },
        severity: values.severity,
      }
    } else if (values.conditionType === 'cert_expiry') {
      const scope = values.certScope ?? 'all'
      input = {
        hostId: null,
        name: values.name,
        conditionType: 'cert_expiry',
        config: {
          scope,
          ...(scope === 'specific' && values.certificateId ? { certificateId: values.certificateId } : {}),
          daysBeforeExpiry: values.daysBeforeExpiry ?? 30,
        },
        severity: values.severity,
      }
    } else {
      if (!values.metric || !values.operator || values.threshold == null) return
      input = {
        hostId,
        name: values.name,
        conditionType: 'metric_threshold',
        config: { metric: values.metric, operator: values.operator, threshold: values.threshold },
        severity: values.severity,
      }
    }

    const result = await createAlertRule(orgId, input)
    if ('error' in result) return
    reset()
    onSuccess()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Alert Rule</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Condition type selector */}
          <div className="space-y-1.5">
            <Label>Condition Type</Label>
            <Controller
              name="conditionType"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v)
                    setConditionType(v as 'check_status' | 'metric_threshold' | 'cert_expiry')
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check_status">Check failure</SelectItem>
                    <SelectItem value="metric_threshold">Metric threshold</SelectItem>
                    <SelectItem value="cert_expiry">Certificate expiry</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input id="rule-name" placeholder="e.g. Web server down" {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>

          {/* check_status fields */}
          {conditionType === 'check_status' && (
            <>
              <div className="space-y-1.5">
                <Label>Check</Label>
                <Controller
                  name="checkId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a check…" />
                      </SelectTrigger>
                      <SelectContent>
                        {checks.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {'checkId' in errors && errors.checkId && (
                  <p className="text-sm text-red-600">{errors.checkId.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="failure-threshold">Consecutive failures before firing</Label>
                <Input
                  id="failure-threshold"
                  type="number"
                  min={1}
                  max={10}
                  {...register('failureThreshold', { valueAsNumber: true })}
                />
              </div>
            </>
          )}

          {/* metric_threshold fields */}
          {conditionType === 'metric_threshold' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Metric</Label>
                  <Controller
                    name="metric"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Pick…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cpu">CPU</SelectItem>
                          <SelectItem value="memory">Memory</SelectItem>
                          <SelectItem value="disk">Disk</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Operator</Label>
                  <Controller
                    name="operator"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Pick…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gt">{'>'} (above)</SelectItem>
                          <SelectItem value="lt">{'<'} (below)</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="threshold">Threshold (%)</Label>
                  <Input
                    id="threshold"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="e.g. 90"
                    {...register('threshold', { valueAsNumber: true })}
                  />
                </div>
              </div>
            </>
          )}

          {/* cert_expiry fields */}
          {conditionType === 'cert_expiry' && (
            <>
              <div className="space-y-1.5">
                <Label>Scope</Label>
                <Controller
                  name="certScope"
                  control={control}
                  defaultValue="all"
                  render={({ field }) => (
                    <Select
                      value={field.value ?? 'all'}
                      onValueChange={(v) => {
                        field.onChange(v)
                        setCertScope(v as 'all' | 'specific')
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All certificates</SelectItem>
                        <SelectItem value="specific">Specific certificate</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              {certScope === 'specific' && (
                <div className="space-y-1.5">
                  <Label>Certificate</Label>
                  <Controller
                    name="certificateId"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value ?? ''} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a certificate…" />
                        </SelectTrigger>
                        <SelectContent>
                          {orgCerts.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.commonName} ({c.host}:{c.port})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="days-before-expiry">Days before expiry</Label>
                <Input
                  id="days-before-expiry"
                  type="number"
                  min={1}
                  max={365}
                  placeholder="e.g. 30"
                  {...register('daysBeforeExpiry', { valueAsNumber: true })}
                />
              </div>
            </>
          )}

          {/* Severity */}
          <div className="space-y-1.5">
            <Label>Severity</Label>
            <Controller
              name="severity"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Add Rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

interface Props {
  orgId: string
  hostId: string
  currentUserId: string
}

export function AlertsTab({ orgId, hostId, currentUserId }: Props) {
  const qc = useQueryClient()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addSilenceOpen, setAddSilenceOpen] = useState(false)

  const { data: allRules = [] } = useQuery({
    queryKey: ['alert-rules', orgId, hostId],
    queryFn: () => getAlertRules(orgId, hostId),
    refetchInterval: 30_000,
  })

  const { data: activeAlerts = [] } = useQuery({
    queryKey: ['alerts', orgId, 'firing', hostId],
    queryFn: () => getAlertInstances(orgId, { status: 'firing', hostId }),
    refetchInterval: 30_000,
  })

  const { data: activeSilences = [] } = useQuery({
    queryKey: ['silences-active', orgId, hostId],
    queryFn: () => getActiveSilencesForHost(orgId, hostId),
    refetchInterval: 60_000,
  })

  const hostRules = allRules.filter((r) => r.hostId === hostId)
  const orgWideRules = allRules.filter((r) => r.hostId === null)

  const toggleMutation = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      updateAlertRule(orgId, ruleId, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules', orgId, hostId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => deleteAlertRule(orgId, ruleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules', orgId, hostId] }),
  })

  const deleteSilenceMutation = useMutation({
    mutationFn: (silenceId: string) => deleteSilence(orgId, silenceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['silences-active', orgId, hostId] }),
  })

  const currentSilence = activeSilences[0] ?? null

  return (
    <div className="space-y-6">
      {/* Active silence banner */}
      {currentSilence != null && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-amber-900 flex items-center gap-2">
                <VolumeOff className="size-4 shrink-0" />
                <span>
                  <strong>Alerts silenced</strong> — {currentSilence.reason}.{' '}
                  Ends {format(new Date(currentSilence.endsAt), 'MMM d, HH:mm')}.
                </span>
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="text-amber-800 hover:text-amber-900 hover:bg-amber-100 shrink-0 -mt-0.5"
                onClick={() => deleteSilenceMutation.mutate(currentSilence.id)}
                disabled={deleteSilenceMutation.isPending}
              >
                Remove silence
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active alerts summary */}
      {activeAlerts.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-red-800 flex items-center gap-2">
              <Bell className="size-4" />
              <strong>{activeAlerts.length}</strong> active alert{activeAlerts.length !== 1 ? 's' : ''} firing on this host.
              View and acknowledge on the{' '}
              <a href="/alerts" className="underline underline-offset-2">
                Alerts page
              </a>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {/* Host-specific rules */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">Alert Rules</CardTitle>
            <CardDescription className="mt-1">Rules that apply specifically to this host</CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={() => setAddSilenceOpen(true)}>
              <VolumeX className="size-3.5 mr-1" />
              Silence Host
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddDialogOpen(true)}>
              <Plus className="size-3.5 mr-1" />
              Add Rule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {hostRules.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No rules for this host yet. Add one to start alerting.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hostRules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ruleConditionSummary(rule)}
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={rule.severity as AlertSeverity} />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(enabled) =>
                          toggleMutation.mutate({ ruleId: rule.id, enabled })
                        }
                        disabled={toggleMutation.isPending}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => deleteMutation.mutate(rule.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Org-wide rules (read-only) */}
      {orgWideRules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Organisation-wide Rules</CardTitle>
            <CardDescription>These rules apply to all hosts in your organisation</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgWideRules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ruleConditionSummary(rule)}
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={rule.severity as AlertSeverity} />
                    </TableCell>
                    <TableCell>
                      <Switch checked={rule.enabled} disabled />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(rule.createdAt), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AddRuleDialog
        orgId={orgId}
        hostId={hostId}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['alert-rules', orgId, hostId] })}
      />
      <AddSilenceDialog
        orgId={orgId}
        hostId={hostId}
        userId={currentUserId}
        open={addSilenceOpen}
        onOpenChange={setAddSilenceOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['silences-active', orgId, hostId] })}
      />
    </div>
  )
}
