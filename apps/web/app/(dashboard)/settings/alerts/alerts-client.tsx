'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Info, Plus, Trash2 } from 'lucide-react'
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
  orgId,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string
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
    const result = await createGlobalAlertDefault(orgId, {
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
            <Input id="name" placeholder="e.g. High CPU Usage" {...register('name')} />
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
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
  orgId: string
  initialDefaults: AlertRule[]
}

export function GlobalAlertsClient({ orgId, initialDefaults }: GlobalAlertsClientProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data: defaults = initialDefaults } = useQuery({
    queryKey: ['global-alert-defaults', orgId],
    queryFn: () => getGlobalAlertDefaults(orgId),
    initialData: initialDefaults,
  })

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => deleteGlobalAlertDefault(orgId, ruleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['global-alert-defaults', orgId] }),
  })

  return (
    <div className="space-y-6 p-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Global Alert Defaults</h1>
        <p className="text-sm text-muted-foreground mt-1">
          These metric alert rules are automatically applied to every new host when an agent is approved.
          After a host is added you can remove individual rules from the host&apos;s Alerts tab.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between pb-3">
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
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4 mr-1" />
            Add Default
          </Button>
        </CardHeader>
        <CardContent>
          {defaults.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
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
                  <TableRow key={rule.id}>
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
          Changes to global defaults only affect newly approved hosts. Existing hosts are not modified.
          To update alert rules on existing hosts, go to the host&apos;s Alerts tab.
        </p>
      </div>

      <AddDefaultDialog
        orgId={orgId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['global-alert-defaults', orgId] })}
      />
    </div>
  )
}
