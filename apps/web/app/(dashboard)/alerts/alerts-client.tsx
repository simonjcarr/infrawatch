'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import {
  Bell,
  BellOff,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Trash2,
  VolumeX,
  Webhook,
  XCircle,
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
  getAlertInstanceCount,
  acknowledgeAlert,
  getNotificationChannels,
  createNotificationChannel,
  deleteNotificationChannel,
  updateNotificationChannel,
  sendTestNotification,
  getSilences,
  createSilence,
  deleteSilence,
} from '@/lib/actions/alerts'
import type { AlertInstanceWithRule, NotificationChannelSafe, AlertSilenceWithHost } from '@/lib/actions/alerts'
import type { AlertSeverity, AlertInstanceStatus } from '@/lib/db/schema'
import type { HostWithAgent } from '@/lib/actions/agents'

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

type SmtpEncryptionValue = 'none' | 'starttls' | 'tls'

const ENCRYPTION_DEFAULTS: Record<SmtpEncryptionValue, number> = {
  none: 25,
  starttls: 587,
  tls: 465,
}

const ENCRYPTION_LABELS: Record<SmtpEncryptionValue, { label: string; description: string }> = {
  none:     { label: 'None',     description: 'Unencrypted — not recommended' },
  starttls: { label: 'STARTTLS', description: 'Plain connect, upgrades to TLS (port 587)' },
  tls:      { label: 'SSL/TLS',  description: 'Direct TLS connection (port 465)' },
}

const smtpFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535),
  encryption: z.enum(['none', 'starttls', 'tls']),
  username: z.string().optional(),
  password: z.string().optional(),
  fromAddress: z.string().email('Must be a valid email'),
  fromName: z.string().optional(),
  toAddresses: z.string().min(1, 'At least one recipient required'),
})

type SmtpFormValues = z.infer<typeof smtpFormSchema>

function SmtpEncryptionSelect({
  value,
  onChange,
}: {
  value: SmtpEncryptionValue
  onChange: (v: SmtpEncryptionValue) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SmtpEncryptionValue)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(ENCRYPTION_LABELS) as [SmtpEncryptionValue, { label: string; description: string }][]).map(
          ([key, { label, description }]) => (
            <SelectItem key={key} value={key}>
              <span className="font-medium">{label}</span>
              <span className="ml-2 text-muted-foreground text-xs">{description}</span>
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  )
}

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
    defaultValues: { port: 587, encryption: 'starttls' },
  })

  const encryption = watch('encryption') as SmtpEncryptionValue

  function handleEncryptionChange(v: SmtpEncryptionValue) {
    setValue('encryption', v)
    setValue('port', ENCRYPTION_DEFAULTS[v])
  }

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
        encryption: values.encryption,
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
              <Input id="smtp-port" type="number" {...register('port', { valueAsNumber: true })} />
              {errors.port && <p className="text-sm text-red-600">{errors.port.message}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Encryption</Label>
            <SmtpEncryptionSelect value={encryption} onChange={handleEncryptionChange} />
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

// ─── Test Log Dialog ───────────────────────────────────────────────────────────

interface TestLogEntry {
  channelName: string
  channelType: 'webhook' | 'smtp' | 'slack' | 'telegram'
  ok: boolean
  message: string
  at: Date
}

function TestLogDialog({
  entry,
  onClose,
}: {
  entry: TestLogEntry
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {entry.channelType === 'smtp' ? (
              <Mail className="size-4 text-muted-foreground" />
            ) : (
              <Webhook className="size-4 text-muted-foreground" />
            )}
            Test Notification — {entry.channelName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div
            className={`flex items-start gap-3 rounded-md border p-3 ${
              entry.ok
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {entry.ok ? (
              <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-green-600" />
            ) : (
              <XCircle className="size-4 mt-0.5 shrink-0 text-red-600" />
            )}
            <div className="space-y-1 min-w-0">
              <p className="text-sm font-medium">
                {entry.ok ? 'Test notification sent successfully' : 'Test notification failed'}
              </p>
              {!entry.ok && (
                <p className="text-sm font-mono break-all">{entry.message}</p>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Sent at {entry.at.toLocaleTimeString()} on {entry.at.toLocaleDateString()}
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit Webhook Dialog ───────────────────────────────────────────────────────

const editWebhookFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  url: z.string().url('Must be a valid URL'),
  secret: z.string().optional(),
})

type EditWebhookFormValues = z.infer<typeof editWebhookFormSchema>

function EditWebhookDialog({
  orgId,
  channel,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string
  channel: NotificationChannelSafe & { type: 'webhook' }
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditWebhookFormValues>({ resolver: zodResolver(editWebhookFormSchema) })

  useEffect(() => {
    if (open) reset({ name: channel.name, url: channel.config.url, secret: '' })
  }, [open, channel, reset])

  async function onSubmit(values: EditWebhookFormValues) {
    const result = await updateNotificationChannel(orgId, channel.id, {
      name: values.name,
      url: values.url,
      secret: values.secret || undefined,
    })
    if ('error' in result) return
    onSuccess()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Webhook Channel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-webhook-name">Name</Label>
            <Input id="edit-webhook-name" defaultValue={channel.name} {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-webhook-url">URL</Label>
            <Input id="edit-webhook-url" type="url" defaultValue={channel.config.url} {...register('url')} />
            {errors.url && <p className="text-sm text-red-600">{errors.url.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-webhook-secret">
              Secret{' '}
              <span className="text-muted-foreground font-normal">
                ({channel.config.hasSecret ? 'leave blank to keep existing' : 'optional'})
              </span>
            </Label>
            <Input
              id="edit-webhook-secret"
              placeholder={channel.config.hasSecret ? '••••••••' : 'Used for HMAC-SHA256 signature'}
              type="password"
              {...register('secret')}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit SMTP Dialog ──────────────────────────────────────────────────────────

const editSmtpFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535),
  encryption: z.enum(['none', 'starttls', 'tls']),
  username: z.string().optional(),
  password: z.string().optional(),
  fromAddress: z.string().email('Must be a valid email'),
  fromName: z.string().optional(),
  toAddresses: z.string().min(1, 'At least one recipient required'),
})

type EditSmtpFormValues = z.infer<typeof editSmtpFormSchema>

function EditSmtpDialog({
  orgId,
  channel,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string
  channel: NotificationChannelSafe & { type: 'smtp' }
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EditSmtpFormValues>({
    resolver: zodResolver(editSmtpFormSchema),
    defaultValues: {
      name: channel.name,
      host: channel.config.host,
      port: channel.config.port,
      encryption: channel.config.encryption,
      username: channel.config.username ?? '',
      password: '',
      fromAddress: channel.config.fromAddress,
      fromName: channel.config.fromName ?? '',
      toAddresses: channel.config.toAddresses.join(', '),
    },
  })

  const encryption = watch('encryption') as SmtpEncryptionValue

  function handleEncryptionChange(v: SmtpEncryptionValue) {
    setValue('encryption', v)
    setValue('port', ENCRYPTION_DEFAULTS[v])
  }

  async function onSubmit(values: EditSmtpFormValues) {
    const toAddresses = values.toAddresses
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)

    const result = await updateNotificationChannel(orgId, channel.id, {
      name: values.name,
      host: values.host,
      port: values.port,
      encryption: values.encryption,
      username: values.username || undefined,
      password: values.password || undefined,
      fromAddress: values.fromAddress,
      fromName: values.fromName || undefined,
      toAddresses,
    })
    if ('error' in result) return
    onSuccess()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit SMTP Channel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-smtp-name">Name</Label>
            <Input id="edit-smtp-name" {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="edit-smtp-host">Host</Label>
              <Input id="edit-smtp-host" {...register('host')} />
              {errors.host && <p className="text-sm text-red-600">{errors.host.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-smtp-port">Port</Label>
              <Input id="edit-smtp-port" type="number" {...register('port', { valueAsNumber: true })} />
              {errors.port && <p className="text-sm text-red-600">{errors.port.message}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Encryption</Label>
            <SmtpEncryptionSelect value={encryption} onChange={handleEncryptionChange} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-smtp-username">
                Username <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="edit-smtp-username" {...register('username')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-smtp-password">
                Password{' '}
                <span className="text-muted-foreground font-normal">
                  ({channel.config.hasPassword ? 'leave blank to keep existing' : 'optional'})
                </span>
              </Label>
              <Input
                id="edit-smtp-password"
                type="password"
                placeholder={channel.config.hasPassword ? '••••••••' : ''}
                {...register('password')}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-smtp-from">From address</Label>
              <Input id="edit-smtp-from" {...register('fromAddress')} />
              {errors.fromAddress && <p className="text-sm text-red-600">{errors.fromAddress.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-smtp-fromname">
                From name <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="edit-smtp-fromname" {...register('fromName')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-smtp-to">Recipients</Label>
            <Input id="edit-smtp-to" {...register('toAddresses')} />
            <p className="text-xs text-muted-foreground">Comma-separated list of email addresses</p>
            {errors.toAddresses && <p className="text-sm text-red-600">{errors.toAddresses.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Slack Dialogs ────────────────────────────────────────────────────────────

const slackFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  webhookUrl: z.string().url('Must be a valid URL'),
})

type SlackFormValues = z.infer<typeof slackFormSchema>

function AddSlackDialog({
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
  } = useForm<SlackFormValues>({ resolver: zodResolver(slackFormSchema) })

  async function onSubmit(values: SlackFormValues) {
    const result = await createNotificationChannel(orgId, {
      name: values.name,
      type: 'slack',
      config: { webhookUrl: values.webhookUrl },
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
          <DialogTitle>Add Slack Channel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="slack-name">Name</Label>
            <Input id="slack-name" placeholder="e.g. #alerts-channel" {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slack-url">Incoming Webhook URL</Label>
            <Input
              id="slack-url"
              placeholder="https://hooks.slack.com/services/..."
              type="url"
              {...register('webhookUrl')}
            />
            <p className="text-xs text-muted-foreground">
              Create an incoming webhook in your Slack workspace settings
            </p>
            {errors.webhookUrl && <p className="text-sm text-red-600">{errors.webhookUrl.message}</p>}
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

function EditSlackDialog({
  orgId,
  channel,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string
  channel: NotificationChannelSafe & { type: 'slack' }
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SlackFormValues>({ resolver: zodResolver(slackFormSchema) })

  useEffect(() => {
    if (open) reset({ name: channel.name, webhookUrl: channel.config.webhookUrl })
  }, [open, channel, reset])

  async function onSubmit(values: SlackFormValues) {
    const result = await updateNotificationChannel(orgId, channel.id, {
      name: values.name,
      webhookUrl: values.webhookUrl,
    })
    if ('error' in result) return
    onSuccess()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Slack Channel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-slack-name">Name</Label>
            <Input id="edit-slack-name" {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-slack-url">Incoming Webhook URL</Label>
            <Input id="edit-slack-url" type="url" {...register('webhookUrl')} />
            {errors.webhookUrl && <p className="text-sm text-red-600">{errors.webhookUrl.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Telegram Dialogs ─────────────────────────────────────────────────────────

const telegramFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  botToken: z.string().min(1, 'Bot token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
})

type TelegramFormValues = z.infer<typeof telegramFormSchema>

function AddTelegramDialog({
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
  } = useForm<TelegramFormValues>({ resolver: zodResolver(telegramFormSchema) })

  async function onSubmit(values: TelegramFormValues) {
    const result = await createNotificationChannel(orgId, {
      name: values.name,
      type: 'telegram',
      config: { botToken: values.botToken, chatId: values.chatId },
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
          <DialogTitle>Add Telegram Channel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tg-name">Name</Label>
            <Input id="tg-name" placeholder="e.g. Ops Team Telegram" {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tg-token">Bot Token</Label>
            <Input
              id="tg-token"
              placeholder="123456789:ABCdef..."
              type="password"
              {...register('botToken')}
            />
            <p className="text-xs text-muted-foreground">
              Create a bot via @BotFather on Telegram and paste the token here
            </p>
            {errors.botToken && <p className="text-sm text-red-600">{errors.botToken.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tg-chat">Chat ID</Label>
            <Input
              id="tg-chat"
              placeholder="-1001234567890"
              {...register('chatId')}
            />
            <p className="text-xs text-muted-foreground">
              The numeric ID of the chat, group, or channel to send messages to
            </p>
            {errors.chatId && <p className="text-sm text-red-600">{errors.chatId.message}</p>}
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

const editTelegramFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  botToken: z.string().optional(),
  chatId: z.string().min(1, 'Chat ID is required'),
})

type EditTelegramFormValues = z.infer<typeof editTelegramFormSchema>

function EditTelegramDialog({
  orgId,
  channel,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string
  channel: NotificationChannelSafe & { type: 'telegram' }
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditTelegramFormValues>({ resolver: zodResolver(editTelegramFormSchema) })

  useEffect(() => {
    if (open) reset({ name: channel.name, botToken: '', chatId: channel.config.chatId })
  }, [open, channel, reset])

  async function onSubmit(values: EditTelegramFormValues) {
    const result = await updateNotificationChannel(orgId, channel.id, {
      name: values.name,
      botToken: values.botToken || undefined,
      chatId: values.chatId,
    })
    if ('error' in result) return
    onSuccess()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Telegram Channel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-tg-name">Name</Label>
            <Input id="edit-tg-name" {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-tg-token">
              Bot Token{' '}
              {channel.config.hasBotToken && (
                <span className="text-muted-foreground font-normal">(leave blank to keep existing)</span>
              )}
            </Label>
            <Input
              id="edit-tg-token"
              type="password"
              placeholder={channel.config.hasBotToken ? '••••••••' : '123456789:ABCdef...'}
              {...register('botToken')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-tg-chat">Chat ID</Label>
            <Input id="edit-tg-chat" {...register('chatId')} />
            {errors.chatId && <p className="text-sm text-red-600">{errors.chatId.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Add Silence Dialog ────────────────────────────────────────────────────────

function toLocalDatetimeValue(d: Date): string {
  // Returns a string suitable for <input type="datetime-local"> in local time
  const offset = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - offset).toISOString().slice(0, 16)
}

const silenceFormSchema = z.object({
  hostId: z.string().optional(),
  reason: z.string().min(1, 'Reason is required').max(255),
  startsAt: z.string().min(1, 'Start time is required'),
  endsAt: z.string().min(1, 'End time is required'),
})

type SilenceFormValues = z.infer<typeof silenceFormSchema>

function AddSilenceDialog({
  orgId,
  userId,
  hosts,
  open,
  onOpenChange,
  onSuccess,
  prefilledHostId,
}: {
  orgId: string
  userId: string
  hosts: HostWithAgent[]
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
  prefilledHostId?: string
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
      hostId: prefilledHostId ?? '',
      startsAt: toLocalDatetimeValue(now),
      endsAt: toLocalDatetimeValue(inOneHour),
    },
  })

  async function onSubmit(values: SilenceFormValues) {
    const result = await createSilence(orgId, userId, {
      hostId: values.hostId || null,
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
          <DialogTitle>Create Silence</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="silence-host">Host <span className="text-muted-foreground font-normal">(leave blank for org-wide)</span></Label>
            <select
              id="silence-host"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...register('hostId')}
            >
              <option value="">All hosts (org-wide)</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.hostname}
                </option>
              ))}
            </select>
          </div>
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

// ─── Main Component ────────────────────────────────────────────────────────────

interface AlertsClientProps {
  orgId: string
  currentUserId: string
  initialActive: AlertInstanceWithRule[]
  initialChannels: NotificationChannelSafe[]
  initialSilences: AlertSilenceWithHost[]
  hosts: HostWithAgent[]
}

type SeverityFilter = 'all' | AlertSeverity

const HISTORY_PAGE_SIZE = 25

export function AlertsClient({
  orgId,
  currentUserId,
  initialActive,
  initialChannels,
  initialSilences,
  hosts,
}: AlertsClientProps) {
  const qc = useQueryClient()
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [addWebhookOpen, setAddWebhookOpen] = useState(false)
  const [addSmtpOpen, setAddSmtpOpen] = useState(false)
  const [addSlackOpen, setAddSlackOpen] = useState(false)
  const [addTelegramOpen, setAddTelegramOpen] = useState(false)
  const [addSilenceOpen, setAddSilenceOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<NotificationChannelSafe | null>(null)
  const [testingChannelId, setTestingChannelId] = useState<string | null>(null)
  const [testLog, setTestLog] = useState<TestLogEntry | null>(null)

  // History pagination + filters
  const [historyPage, setHistoryPage] = useState(0)
  const [historyDateFrom, setHistoryDateFrom] = useState('')
  const [historyDateTo, setHistoryDateTo] = useState('')
  const [historySeverity, setHistorySeverity] = useState<SeverityFilter>('all')

  const historyFilters = {
    severity: historySeverity !== 'all' ? historySeverity : undefined,
    dateFrom: historyDateFrom ? new Date(historyDateFrom) : undefined,
    dateTo: historyDateTo ? new Date(historyDateTo + 'T23:59:59') : undefined,
  }

  const { data: activeAlerts = [] } = useQuery({
    queryKey: ['alerts', orgId, 'firing'],
    queryFn: () => getAlertInstances(orgId, { status: 'firing', limit: 100 }),
    initialData: initialActive,
    refetchInterval: 30_000,
  })

  const { data: historyAlerts = [], isFetching: historyFetching } = useQuery({
    queryKey: ['alerts', orgId, 'history', historyPage, historyFilters],
    queryFn: () =>
      getAlertInstances(orgId, {
        ...historyFilters,
        limit: HISTORY_PAGE_SIZE,
        offset: historyPage * HISTORY_PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  })

  const { data: historyTotal = 0 } = useQuery({
    queryKey: ['alerts', orgId, 'history-count', historyFilters],
    queryFn: () => getAlertInstanceCount(orgId, historyFilters),
  })

  const { data: channels = [] } = useQuery({
    queryKey: ['notification-channels', orgId],
    queryFn: () => getNotificationChannels(orgId),
    initialData: initialChannels,
    refetchInterval: 60_000,
  })

  const { data: silences = [] } = useQuery({
    queryKey: ['silences', orgId],
    queryFn: () => getSilences(orgId),
    initialData: initialSilences,
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

  const deleteSilenceMutation = useMutation({
    mutationFn: (silenceId: string) => deleteSilence(orgId, silenceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['silences', orgId] })
    },
  })

  async function handleTestNotification(channel: NotificationChannelSafe) {
    setTestingChannelId(channel.id)
    const result = await sendTestNotification(orgId, channel.id)
    setTestingChannelId(null)
    setTestLog({
      channelName: channel.name,
      channelType: channel.type,
      ok: 'success' in result,
      message: 'error' in result ? result.error : 'Notification delivered successfully.',
      at: new Date(),
    })
  }

  function resetHistoryFilters() {
    setHistoryDateFrom('')
    setHistoryDateTo('')
    setHistorySeverity('all')
    setHistoryPage(0)
  }

  const historyPageCount = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE))
  const historyFrom = historyTotal === 0 ? 0 : historyPage * HISTORY_PAGE_SIZE + 1
  const historyTo = Math.min((historyPage + 1) * HISTORY_PAGE_SIZE, historyTotal)

  const filteredActive = severityFilter === 'all'
    ? activeAlerts
    : activeAlerts.filter((a) => a.ruleSeverity === severityFilter)

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

      {/* Alert History */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="size-4 text-muted-foreground" />
                Alert History
              </CardTitle>
              <CardDescription>
                {historyTotal > 0
                  ? `${historyFrom}–${historyTo} of ${historyTotal} alerts`
                  : 'No history yet'}
              </CardDescription>
            </div>
          </div>

          {/* History filters */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Select
              value={historySeverity}
              onValueChange={(v) => { setHistorySeverity(v as SeverityFilter); setHistoryPage(0) }}
            >
              <SelectTrigger className="w-36 h-8 text-sm">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              className="w-36 h-8 text-sm"
              value={historyDateFrom}
              onChange={(e) => { setHistoryDateFrom(e.target.value); setHistoryPage(0) }}
              placeholder="From"
            />
            <Input
              type="date"
              className="w-36 h-8 text-sm"
              value={historyDateTo}
              onChange={(e) => { setHistoryDateTo(e.target.value); setHistoryPage(0) }}
              placeholder="To"
            />
            {(historySeverity !== 'all' || historyDateFrom || historyDateTo) && (
              <Button variant="ghost" size="sm" className="h-8 text-sm" onClick={resetHistoryFilters}>
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {historyAlerts.length === 0 && !historyFetching ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No alerts match the current filters</p>
          ) : (
            <div className={historyFetching ? 'opacity-60 transition-opacity' : ''}>
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
                  {historyAlerts.map((alert) => (
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
            </div>
          )}

          {historyPageCount > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                Page {historyPage + 1} of {historyPageCount}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={historyPage === 0 || historyFetching}
                  onClick={() => setHistoryPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={historyPage >= historyPageCount - 1 || historyFetching}
                  onClick={() => setHistoryPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Silences */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <VolumeX className="size-4 text-muted-foreground" />
              Silences
            </CardTitle>
            <CardDescription className="mt-1">
              Suppress alert firing during planned maintenance windows
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setAddSilenceOpen(true)}
          >
            <Plus className="size-3.5 mr-1" />
            Add Silence
          </Button>
        </CardHeader>
        <CardContent>
          {silences.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No silences configured
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {silences.map((s) => {
                  const now = new Date()
                  const start = new Date(s.startsAt)
                  const end = new Date(s.endsAt)
                  const isActive = start <= now && end >= now
                  const isExpired = end < now
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        {s.hostname ? (
                          <Link href={`/hosts/${s.hostId}`} className="hover:underline text-foreground">
                            {s.hostname}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground italic">All hosts</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {s.reason}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatAbsolute(s.startsAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatAbsolute(s.endsAt)}
                      </TableCell>
                      <TableCell>
                        {isActive ? (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
                            Active
                          </Badge>
                        ) : isExpired ? (
                          <Badge className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">
                            Expired
                          </Badge>
                        ) : (
                          <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">
                            Upcoming
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Remove silence"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => deleteSilenceMutation.mutate(s.id)}
                          disabled={deleteSilenceMutation.isPending}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
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
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddSlackOpen(true)}
            >
              <Plus className="size-3.5 mr-1" />
              Add Slack
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddTelegramOpen(true)}
            >
              <Plus className="size-3.5 mr-1" />
              Add Telegram
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
                      ) : ch.type === 'slack' ? (
                        <Badge variant="outline" className="gap-1">
                          <MessageSquare className="size-3" />
                          Slack
                        </Badge>
                      ) : ch.type === 'telegram' ? (
                        <Badge variant="outline" className="gap-1">
                          <Send className="size-3" />
                          Telegram
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
                          {ch.config.host}:{ch.config.port} ({ch.config.encryption.toUpperCase()}) → {ch.config.toAddresses.join(', ')}
                        </span>
                      ) : ch.type === 'slack' ? (
                        <span className="font-mono truncate block max-w-xs">{ch.config.webhookUrl}</span>
                      ) : ch.type === 'telegram' ? (
                        <span>Chat ID: {ch.config.chatId}</span>
                      ) : (
                        <span className="font-mono truncate block max-w-xs">{ch.config.url}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Send test notification"
                          onClick={() => handleTestNotification(ch)}
                          disabled={testingChannelId === ch.id}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {testingChannelId === ch.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <FlaskConical className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Edit channel"
                          onClick={() => setEditingChannel(ch)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Delete channel"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => deleteChannelMutation.mutate(ch.id)}
                          disabled={deleteChannelMutation.isPending}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddSilenceDialog
        orgId={orgId}
        userId={currentUserId}
        hosts={hosts}
        open={addSilenceOpen}
        onOpenChange={setAddSilenceOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['silences', orgId] })}
      />
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
      <AddSlackDialog
        orgId={orgId}
        open={addSlackOpen}
        onOpenChange={setAddSlackOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['notification-channels', orgId] })}
      />
      <AddTelegramDialog
        orgId={orgId}
        open={addTelegramOpen}
        onOpenChange={setAddTelegramOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['notification-channels', orgId] })}
      />
      {testLog && (
        <TestLogDialog entry={testLog} onClose={() => setTestLog(null)} />
      )}
      {editingChannel?.type === 'webhook' && (
        <EditWebhookDialog
          orgId={orgId}
          channel={editingChannel}
          open={true}
          onOpenChange={(v) => { if (!v) setEditingChannel(null) }}
          onSuccess={() => {
            setEditingChannel(null)
            qc.invalidateQueries({ queryKey: ['notification-channels', orgId] })
          }}
        />
      )}
      {editingChannel?.type === 'smtp' && (
        <EditSmtpDialog
          orgId={orgId}
          channel={editingChannel}
          open={true}
          onOpenChange={(v) => { if (!v) setEditingChannel(null) }}
          onSuccess={() => {
            setEditingChannel(null)
            qc.invalidateQueries({ queryKey: ['notification-channels', orgId] })
          }}
        />
      )}
      {editingChannel?.type === 'slack' && (
        <EditSlackDialog
          orgId={orgId}
          channel={editingChannel}
          open={true}
          onOpenChange={(v) => { if (!v) setEditingChannel(null) }}
          onSuccess={() => {
            setEditingChannel(null)
            qc.invalidateQueries({ queryKey: ['notification-channels', orgId] })
          }}
        />
      )}
      {editingChannel?.type === 'telegram' && (
        <EditTelegramDialog
          orgId={orgId}
          channel={editingChannel}
          open={true}
          onOpenChange={(v) => { if (!v) setEditingChannel(null) }}
          onSuccess={() => {
            setEditingChannel(null)
            qc.invalidateQueries({ queryKey: ['notification-channels', orgId] })
          }}
        />
      )}
    </div>
  )
}
