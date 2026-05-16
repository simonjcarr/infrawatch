'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Info, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getGlobalAlertDefaults,
  createGlobalAlertDefault,
  deleteGlobalAlertDefault,
  replaceAllHostMetricAlertsWithGlobalDefaults,
} from '@/lib/actions/alerts'
import type { AlertRule, AlertSeverity } from '@/lib/db/schema'

// ─── Form schema ──────────────────────────────────────────────────────────────

const ruleFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  severity: z.enum(['info', 'warning', 'critical']),
  metric: z.enum(['cpu', 'memory', 'disk']),
  operator: z.enum(['gt', 'lt']),
  threshold: z.number().min(0).max(100),
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

function ruleSummary(rule: AlertRule): string {
  const cfg = rule.config as unknown as Record<string, unknown>
  const op = cfg['operator'] === 'gt' ? '>' : '<'
  const metricLabel = String(cfg['metric'] ?? '').toUpperCase()
  return `${metricLabel} ${op} ${cfg['threshold']}%`
}

// ─── Add Default Dialog ───────────────────────────────────────────────────────

function AddDefaultDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RuleFormValues>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: {
      severity: 'warning',
      metric: 'cpu',
      operator: 'gt',
      threshold: 80,
    },
  })

  async function onSubmit(values: RuleFormValues) {
    const result = await createGlobalAlertDefault({
      name: values.name,
      severity: values.severity,
      config: {
        metric: values.metric,
        operator: values.operator,
        threshold: values.threshold,
      },
    })
    if ('error' in result) {
      alert(result.error)
      return
    }
    reset()
    onOpenChange(false)
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Global Alert Default</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="name">Rule Name</Label>
            <Input
              id="name"
              placeholder="e.g. High CPU Usage"
              data-testid="settings-alert-default-name"
              {...register('name')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Metric</Label>
              <Controller
                control={control}
                name="metric"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger data-testid="settings-alert-default-metric"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cpu">CPU</SelectItem>
                      <SelectItem value="memory">Memory</SelectItem>
                      <SelectItem value="disk">Disk</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1">
              <Label>Condition</Label>
              <Controller
                control={control}
                name="operator"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger data-testid="settings-alert-default-operator"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gt">Above (&gt;)</SelectItem>
                      <SelectItem value="lt">Below (&lt;)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="threshold">Threshold %</Label>
              <Input
                id="threshold"
                type="number"
                min={0}
                max={100}
                data-testid="settings-alert-default-threshold"
                {...register('threshold', { valueAsNumber: true })}
              />
              {errors.threshold && <p className="text-xs text-destructive">{errors.threshold.message}</p>}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Severity</Label>
              <Controller
                control={control}
                name="severity"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger data-testid="settings-alert-default-severity"><SelectValue /></SelectTrigger>
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
            <Button type="submit" disabled={isSubmitting} data-testid="settings-alert-default-submit">
              {isSubmitting ? 'Adding…' : 'Add Default'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface GlobalAlertsClientProps {
  initialDefaults: AlertRule[]
}

export function GlobalAlertsClient({ initialDefaults }: GlobalAlertsClientProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [replaceAllMessage, setReplaceAllMessage] = useState<string | null>(null)
  const [replaceAllError, setReplaceAllError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: defaults = initialDefaults } = useQuery({
    queryKey: ['global-alert-defaults'],
    queryFn: () => getGlobalAlertDefaults(),
    initialData: initialDefaults,
  })

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => deleteGlobalAlertDefault(ruleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['global-alert-defaults'] }),
  })

  const replaceAllMutation = useMutation({
    mutationFn: async () => {
      const result = await replaceAllHostMetricAlertsWithGlobalDefaults()
      if ('error' in result) throw new Error(result.error)
      return result
    },
    onMutate: () => {
      setReplaceAllError(null)
      setReplaceAllMessage(null)
    },
    onSuccess: (result) => {
      setReplaceAllMessage(
        `Updated ${result.hostCount} host${result.hostCount === 1 ? '' : 's'} with ${result.createdCount} metric default rule${result.createdCount === 1 ? '' : 's'}.`,
      )
    },
    onError: (error) => {
      setReplaceAllError(
        error instanceof Error ? error.message : 'Failed to replace host metric alert rules',
      )
    },
  })

  return (
    <div className="space-y-6 p-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="settings-alert-defaults-heading">Global Alert Defaults</h1>
        <p className="text-sm text-muted-foreground mt-1">
          These metric alert rules are automatically applied to every new host when an agent is approved.
          After a host is added you can remove individual rules from the host&apos;s Alerts tab.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="size-4" />
              Default Alert Rules
            </CardTitle>
            <CardDescription>
              Only metric threshold rules are supported as global defaults.
              Check-based rules must be configured per host since they reference host-specific checks.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => replaceAllMutation.mutate()}
              disabled={replaceAllMutation.isPending}
              data-testid="settings-alert-defaults-replace-all-host-metrics"
            >
              <RotateCcw className="size-4 mr-1" />
              Apply to Hosts
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="settings-alert-defaults-add">
              <Plus className="size-4 mr-1" />
              Add Default
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {replaceAllError != null && (
            <p className="text-sm text-red-600 pb-3" data-testid="settings-alert-defaults-replace-error">
              {replaceAllError}
            </p>
          )}
          {replaceAllMessage != null && (
            <p className="text-sm text-green-700 pb-3" data-testid="settings-alert-defaults-replace-success">
              {replaceAllMessage}
            </p>
          )}
          {defaults.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center" data-testid="settings-alert-defaults-empty">
              <Bell className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No global alert defaults configured.</p>
              <p className="text-xs text-muted-foreground">
                Add defaults above and they&apos;ll be applied to each new host automatically.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {defaults.map((rule) => (
                  <TableRow key={rule.id} data-testid={`settings-alert-default-row-${rule.id}`}>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell className="font-mono text-sm">{ruleSummary(rule)}</TableCell>
                    <TableCell>
                      <SeverityBadge severity={rule.severity as AlertSeverity} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(rule.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`settings-alert-default-delete-${rule.id}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <Info className="size-4 mt-0.5 shrink-0" />
        <p>
          Changes to global defaults are applied automatically to newly approved hosts.
          Use Apply to Hosts to replace existing host-level metric rules with these defaults.
        </p>
      </div>

      <AddDefaultDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['global-alert-defaults'] })}
      />
    </div>
  )
}
