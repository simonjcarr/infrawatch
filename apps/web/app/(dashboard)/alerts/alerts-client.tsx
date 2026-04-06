'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import {
  Bell,
  BellOff,
  CheckCircle2,
  Mail,
  Plus,
  Trash2,
  Webhook,
} from 'lucide-react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getAlertInstances,
  acknowledgeAlert,
  getNotificationChannels,
  createNotificationChannel,
  deleteNotificationChannel,
} from '@/lib/actions/alerts'
import type { AlertInstanceWithRule, NotificationChannelSafe } from '@/lib/actions/alerts'
import type { AlertSeverity, AlertInstanceStatus } from '@/lib/db/schema'

// ─── Severity Badge ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  switch (severity) {
    case 'critical':
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
          Critical
        </Badge>
      )
    case 'warning':
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
          Warning
        </Badge>
      )
    case 'info':
      return (
        <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">
          Info
        </Badge>
      )
  }
}

// ─── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AlertInstanceStatus }) {
  switch (status) {
    case 'firing':
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
          <Bell className="size-3 mr-1" />
          Firing
        </Badge>
      )
    case 'resolved':
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
          <CheckCircle2 className="size-3 mr-1" />
          Resolved
        </Badge>
      )
    case 'acknowledged':
      return (
        <Badge className="bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100">
          <BellOff className="size-3 mr-1" />
          Acknowledged
        </Badge>
      )
  }
}

function formatRelative(date: Date | string | null): string {
  if (!date) return '—'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

function formatAbsolute(date: Date | string | null): string {
  if (!date) return '—'
  return format(new Date(date), 'MMM d, HH:mm')
}

// ─── Webhook Dialog ────────────────────────────────────────────────────────────

const webhookFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  url: z.string().url('Must be a valid URL'),
  secret: z.string().optional(),
})

type WebhookFormValues = z.infer<typeof webhookFormSchema>

function AddWebhookDialog({
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
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WebhookFormValues>({ resolver: zodResolver(webhookFormSchema) })

  async function onSubmit(values: WebhookFormValues) {
    const result = await createNotificationChannel(orgId, {
      name: values.name,
      type: 'webhook',
      config: { url: values.url, secret: values.secret || undefined },
    })
    if ('error' in result) {
      return
    }
    reset()
    onSuccess()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Webhook Channel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="webhook-name">Name</Label>
            <Input id="webhook-name" placeholder="e.g. PagerDuty" {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="webhook-url">URL</Label>
            <Input id="webhook-url" placeholder="https://..." type="url" {...register('url')} />
            {errors.url && <p className="text-sm text-red-600">{errors.url.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="webhook-secret">
              Secret <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="webhook-secret"
              placeholder="Used for HMAC-SHA256 signature"
              type="password"
              {...register('secret')}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Add Channel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── SMTP Dialog ──────────────────────────────────────────────────────────────

const smtpFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().optional(),
  password: z.string().optional(),
  fromAddress: z.string().email('Must be a valid email'),
  fromName: z.string().optional(),
  toAddresses: z.string().min(1, 'At least one recipient required'),
})

type SmtpFormValues = z.infer<typeof smtpFormSchema>

function AddSmtpDialog({
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
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SmtpFormValues>({
    resolver: zodResolver(smtpFormSchema),
    defaultValues: { port: 587, secure: false },
  })

  const secure = watch('secure')

  async function onSubmit(values: SmtpFormValues) {
    const toAddresses = values.toAddresses
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)

    const result = await createNotificationChannel(orgId, {
      name: values.name,
      type: 'smtp',
      config: {
        host: values.host,
        port: values.port,
        secure: values.secure,
        username: values.username || undefined,
        password: values.password || undefined,
        fromAddress: values.fromAddress,
        fromName: values.fromName || undefined,
        toAddresses,
      },
    })
    if ('error' in result) return
    reset()
    onSuccess()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add SMTP Channel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="smtp-name">Name</Label>
            <Input id="smtp-name" placeholder="e.g. Ops Alerts" {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="smtp-host">Host</Label>
              <Input id="smtp-host" placeholder="smtp.example.com" {...register('host')} />
              {errors.host && <p className="text-sm text-red-600">{errors.host.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-port">Port</Label>
              <Input id="smtp-port" type="number" placeholder="587" {...register('port', { valueAsNumber: true })} />
              {errors.port && <p className="text-sm text-red-600">{errors.port.message}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="smtp-secure"
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={secure}
              onChange={(e) => setValue('secure', e.target.checked)}
            />
            <Label htmlFor="smtp-secure" className="font-normal cursor-pointer">
              Use TLS/SSL
            </Label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="smtp-username">
                Username <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="smtp-username" placeholder="user@example.com" {...register('username')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-password">
                Password <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="smtp-password" type="password" placeholder="••••••••" {...register('password')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="smtp-from">From address</Label>
              <Input id="smtp-from" placeholder="alerts@example.com" {...register('fromAddress')} />
              {errors.fromAddress && <p className="text-sm text-red-600">{errors.fromAddress.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-fromname">
                From name <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="smtp-fromname" placeholder="Infrawatch Alerts" {...register('fromName')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-to">Recipients</Label>
            <Input
              id="smtp-to"
              placeholder="ops@example.com, team@example.com"
              {...register('toAddresses')}
            />
            <p className="text-xs text-muted-foreground">Comma-separated list of email addresses</p>
            {errors.toAddresses && <p className="text-sm text-red-600">{errors.toAddresses.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Add Channel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

interface AlertsClientProps {
  orgId: string
  currentUserId: string
  initialActive: AlertInstanceWithRule[]
  initialRecent: AlertInstanceWithRule[]
  initialChannels: NotificationChannelSafe[]
}

type SeverityFilter = 'all' | AlertSeverity

export function AlertsClient({
  orgId,
  currentUserId,
  initialActive,
  initialRecent,
  initialChannels,
}: AlertsClientProps) {
  const qc = useQueryClient()
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [addWebhookOpen, setAddWebhookOpen] = useState(false)
  const [addSmtpOpen, setAddSmtpOpen] = useState(false)

  const { data: activeAlerts = [] } = useQuery({
    queryKey: ['alerts', orgId, 'firing'],
    queryFn: () => getAlertInstances(orgId, { status: 'firing', limit: 100 }),
    initialData: initialActive,
    refetchInterval: 30_000,
  })

  const { data: recentAlerts = [] } = useQuery({
    queryKey: ['alerts', orgId, 'recent'],
    queryFn: () => getAlertInstances(orgId, { limit: 50 }),
    initialData: initialRecent,
    refetchInterval: 30_000,
  })

  const { data: channels = [] } = useQuery({
    queryKey: ['notification-channels', orgId],
    queryFn: () => getNotificationChannels(orgId),
    initialData: initialChannels,
    refetchInterval: 60_000,
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (instanceId: string) => acknowledgeAlert(orgId, instanceId, currentUserId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts', orgId] })
    },
  })

  const deleteChannelMutation = useMutation({
    mutationFn: (channelId: string) => deleteNotificationChannel(orgId, channelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-channels', orgId] })
    },
  })

  const filteredActive = severityFilter === 'all'
    ? activeAlerts
    : activeAlerts.filter((a) => a.ruleSeverity === severityFilter)

  const filteredRecent = severityFilter === 'all'
    ? recentAlerts.filter((a) => a.status !== 'firing')
    : recentAlerts.filter((a) => a.status !== 'firing' && a.ruleSeverity === severityFilter)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Alerts</h1>
        <p className="text-muted-foreground mt-1">
          {activeAlerts.length} active alert{activeAlerts.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground shrink-0">Severity</Label>
        <Select
          value={severityFilter}
          onValueChange={(v) => setSeverityFilter(v as SeverityFilter)}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Active Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="size-4 text-red-500" />
            Active Alerts
            {filteredActive.length > 0 && (
              <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 ml-1">
                {filteredActive.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredActive.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="size-8 mx-auto text-green-500/60 mb-2" />
              <p className="text-muted-foreground">No active alerts</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Triggered</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredActive.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <SeverityBadge severity={alert.ruleSeverity} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/hosts/${alert.hostId}`}
                        className="hover:underline text-foreground"
                      >
                        {alert.hostname}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{alert.ruleName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {alert.message}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatRelative(alert.triggeredAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => acknowledgeMutation.mutate(alert.id)}
                        disabled={acknowledgeMutation.isPending}
                      >
                        Acknowledge
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Resolved / Acknowledged */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="size-4 text-muted-foreground" />
            Recent History
          </CardTitle>
          <CardDescription>Last 50 resolved and acknowledged alerts</CardDescription>
        </CardHeader>
        <CardContent>
          {filteredRecent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No history yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Triggered</TableHead>
                  <TableHead>Resolved / Acknowledged</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecent.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <SeverityBadge severity={alert.ruleSeverity} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={alert.status} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/hosts/${alert.hostId}`}
                        className="hover:underline text-foreground"
                      >
                        {alert.hostname}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{alert.ruleName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatAbsolute(alert.triggeredAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatAbsolute(alert.resolvedAt ?? alert.acknowledgedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Notification Channels */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Webhook className="size-4 text-muted-foreground" />
              Notification Channels
            </CardTitle>
            <CardDescription className="mt-1">
              Channels that receive alert fired/resolved events
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddWebhookOpen(true)}
            >
              <Plus className="size-3.5 mr-1" />
              Add Webhook
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddSmtpOpen(true)}
            >
              <Plus className="size-3.5 mr-1" />
              Add SMTP
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No notification channels configured
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((ch) => (
                  <TableRow key={ch.id}>
                    <TableCell className="font-medium">{ch.name}</TableCell>
                    <TableCell>
                      {ch.type === 'smtp' ? (
                        <Badge variant="outline" className="gap-1">
                          <Mail className="size-3" />
                          SMTP
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <Webhook className="size-3" />
                          Webhook
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ch.type === 'smtp' ? (
                        <span>
                          {ch.config.host}:{ch.config.port} → {ch.config.toAddresses.join(', ')}
                        </span>
                      ) : (
                        <span className="font-mono truncate block max-w-xs">{ch.config.url}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => deleteChannelMutation.mutate(ch.id)}
                        disabled={deleteChannelMutation.isPending}
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

      <AddWebhookDialog
        orgId={orgId}
        open={addWebhookOpen}
        onOpenChange={setAddWebhookOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['notification-channels', orgId] })}
      />
      <AddSmtpDialog
        orgId={orgId}
        open={addSmtpOpen}
        onOpenChange={setAddSmtpOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['notification-channels', orgId] })}
      />
    </div>
  )
}
