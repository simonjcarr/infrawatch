'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
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
  createSchedule,
  updateSchedule,
  previewCronRuns,
} from '@/lib/actions/task-schedules'
import { SCHEDULABLE_TASK_TYPES } from '@/lib/actions/task-schedules-types'
import type { TaskSchedule, TaskRun } from '@/lib/db/schema'

type HostOption = { id: string; hostname: string; os: string | null }
type GroupOption = { id: string; name: string }
type ScheduledType = (typeof SCHEDULABLE_TASK_TYPES)[number]

const TASK_TYPE_LABELS: Record<ScheduledType, string> = {
  patch: 'Patch',
  custom_script: 'Custom script',
  service: 'Service action',
  software_inventory: 'Software inventory',
}

const COMMON_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
]

const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: 'Every 15 minutes', expr: '*/15 * * * *' },
  { label: 'Every hour', expr: '0 * * * *' },
  { label: 'Every day at 02:00', expr: '0 2 * * *' },
  { label: 'Every Monday at 06:00', expr: '0 6 * * 1' },
  { label: 'Every 1st of month at 03:00', expr: '0 3 1 * *' },
]

export function ScheduleForm({
  orgId,
  mode,
  hosts,
  groups,
  schedule,
  recentRuns,
}: {
  orgId: string
  mode: 'create' | 'edit'
  hosts: HostOption[]
  groups: GroupOption[]
  schedule?: TaskSchedule
  recentRuns?: TaskRun[]
}) {
  const router = useRouter()

  const [name, setName] = useState(schedule?.name ?? '')
  const [description, setDescription] = useState(schedule?.description ?? '')
  const [taskType, setTaskType] = useState<ScheduledType>(
    (schedule?.taskType as ScheduledType) ?? 'custom_script',
  )
  const [targetType, setTargetType] = useState<'host' | 'group'>(schedule?.targetType ?? 'host')
  const [targetId, setTargetId] = useState<string>(schedule?.targetId ?? '')
  const [maxParallel, setMaxParallel] = useState<number>(schedule?.maxParallel ?? 1)
  const [cronExpression, setCronExpression] = useState<string>(schedule?.cronExpression ?? '0 2 * * *')
  const [timezone, setTimezone] = useState<string>(schedule?.timezone ?? 'UTC')
  const [enabled, setEnabled] = useState<boolean>(schedule?.enabled ?? true)

  // Per-task-type config state
  const initialConfig = (schedule?.config ?? {}) as Record<string, unknown>
  const [patchMode, setPatchMode] = useState<'security' | 'all'>(
    (initialConfig['mode'] as 'security' | 'all') ?? 'all',
  )
  const [script, setScript] = useState<string>(String(initialConfig['script'] ?? ''))
  const [interpreter, setInterpreter] = useState<'sh' | 'bash' | 'python3'>(
    (initialConfig['interpreter'] as 'sh' | 'bash' | 'python3') ?? 'bash',
  )
  const [timeoutSeconds, setTimeoutSeconds] = useState<string>(
    initialConfig['timeout_seconds'] != null ? String(initialConfig['timeout_seconds']) : '',
  )
  const [serviceName, setServiceName] = useState<string>(String(initialConfig['service_name'] ?? ''))
  const [serviceAction, setServiceAction] = useState<'start' | 'stop' | 'restart' | 'status'>(
    (initialConfig['action'] as 'start' | 'stop' | 'restart' | 'status') ?? 'restart',
  )

  const [preview, setPreview] = useState<string[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    previewCronRuns(cronExpression, timezone, 5).then((result) => {
      if (cancelled) return
      if ('error' in result) {
        setPreview([])
        setPreviewError(result.error)
      } else {
        setPreview(result.runs)
        setPreviewError(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [cronExpression, timezone])

  const config = useMemo<Record<string, unknown>>(() => {
    if (taskType === 'patch') return { mode: patchMode }
    if (taskType === 'custom_script') {
      const c: Record<string, unknown> = { script, interpreter }
      if (timeoutSeconds.trim()) {
        const n = Number(timeoutSeconds)
        if (Number.isFinite(n) && n > 0) c['timeout_seconds'] = n
      }
      return c
    }
    if (taskType === 'service') return { service_name: serviceName, action: serviceAction }
    return {}
  }, [taskType, patchMode, script, interpreter, timeoutSeconds, serviceName, serviceAction])

  const submit = useMutation({
    mutationFn: async () => {
      const input = {
        name,
        description: description || null,
        taskType,
        config,
        targetType,
        targetId,
        maxParallel,
        cronExpression,
        timezone,
        enabled,
      }
      return mode === 'create'
        ? createSchedule(orgId, input)
        : updateSchedule(orgId, schedule!.id, input)
    },
    onSuccess: (result) => {
      if ('error' in result) {
        setFormError(result.error)
        return
      }
      router.push('/tasks')
      router.refresh()
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Failed to save')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!name.trim()) {
      setFormError('Name is required')
      return
    }
    if (!targetId) {
      setFormError('Select a target host or group')
      return
    }
    if (previewError) {
      setFormError(`Invalid cron expression: ${previewError}`)
      return
    }
    submit.mutate()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link href="/tasks">
            <ArrowLeft className="size-4 mr-1" />
            Scheduled Tasks
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold text-foreground" data-testid={`task-schedule-heading-${mode}`}>
          {mode === 'create' ? 'New schedule' : `Edit schedule: ${schedule?.name}`}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6" data-testid={`task-schedule-form-${mode}`}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nightly security patches"
                required
              />
            </div>
            <div>
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description ?? ''}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="enabled" className="font-medium">Enabled</Label>
                <p className="text-xs text-muted-foreground">
                  Disabled schedules never fire, and re-enabling recomputes the next run time.
                </p>
              </div>
              <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Task</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Task type</Label>
              <Select
                value={taskType}
                onValueChange={(v) => setTaskType(v as ScheduledType)}
                disabled={mode === 'edit'}
              >
                <SelectTrigger data-testid="task-schedule-task-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULABLE_TASK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TASK_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mode === 'edit' && (
                <p className="text-xs text-muted-foreground mt-1">
                  Task type cannot be changed — delete and recreate the schedule to switch.
                </p>
              )}
            </div>

            {taskType === 'patch' && (
              <div>
                <Label>Patch mode</Label>
                <Select value={patchMode} onValueChange={(v) => setPatchMode(v as 'security' | 'all')}>
                  <SelectTrigger data-testid="task-schedule-patch-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="security">Security updates only</SelectItem>
                    <SelectItem value="all">All updates</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {taskType === 'custom_script' && (
              <>
                <div>
                  <Label>Interpreter</Label>
                  <Select value={interpreter} onValueChange={(v) => setInterpreter(v as 'sh' | 'bash' | 'python3')}>
                    <SelectTrigger data-testid="task-schedule-script-interpreter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sh">sh</SelectItem>
                      <SelectItem value="bash">bash</SelectItem>
                      <SelectItem value="python3">python3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="script">Script</Label>
                  <Textarea
                    id="script"
                    data-testid="task-schedule-script-body"
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    rows={8}
                    placeholder="#!/bin/bash&#10;echo hello"
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="timeout">Timeout in seconds (optional)</Label>
                  <Input
                    id="timeout"
                    data-testid="task-schedule-script-timeout"
                    type="number"
                    min={1}
                    value={timeoutSeconds}
                    onChange={(e) => setTimeoutSeconds(e.target.value)}
                    placeholder="300"
                  />
                </div>
              </>
            )}

            {taskType === 'service' && (
              <>
                <div>
                  <Label htmlFor="service_name">Service name</Label>
                  <Input
                    id="service_name"
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    placeholder="nginx"
                    required
                  />
                </div>
                <div>
                  <Label>Action</Label>
                  <Select value={serviceAction} onValueChange={(v) => setServiceAction(v as typeof serviceAction)}>
                    <SelectTrigger data-testid="task-schedule-service-action">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="start">start</SelectItem>
                      <SelectItem value="stop">stop</SelectItem>
                      <SelectItem value="restart">restart</SelectItem>
                      <SelectItem value="status">status</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {taskType === 'software_inventory' && (
              <p className="text-sm text-muted-foreground">
                No additional configuration — runs a full package inventory scan on the target.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Target</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Target type</Label>
              <Select
                value={targetType}
                onValueChange={(v) => {
                  setTargetType(v as 'host' | 'group')
                  setTargetId('')
                }}
              >
                <SelectTrigger data-testid="task-schedule-target-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="host">Single host</SelectItem>
                  <SelectItem value="group">Host group</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{targetType === 'host' ? 'Host' : 'Group'}</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger data-testid="task-schedule-target-id">
                  <SelectValue placeholder={`Select a ${targetType}`} />
                </SelectTrigger>
                <SelectContent>
                  {targetType === 'host'
                    ? hosts.map((h) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.hostname} {h.os ? `(${h.os})` : ''}
                        </SelectItem>
                      ))
                    : groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>
            {targetType === 'group' && (
              <div>
                <Label htmlFor="max_parallel">Max parallel hosts</Label>
                <Input
                  id="max_parallel"
                  type="number"
                  min={0}
                  max={100}
                  value={maxParallel}
                  onChange={(e) => setMaxParallel(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground mt-1">0 = unlimited.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="cron">Cron expression (5 fields: minute hour dom month dow)</Label>
              <Input
                id="cron"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                className="font-mono"
                required
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {CRON_PRESETS.map((p) => (
                  <Button
                    key={p.expr}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCronExpression(p.expr)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger data-testid="task-schedule-timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Next 5 scheduled runs</Label>
              {previewError ? (
                <p className="text-sm text-destructive" data-testid="task-schedule-preview-error">{previewError}</p>
              ) : preview.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="task-schedule-preview-empty">—</p>
              ) : (
                <ul className="text-sm space-y-0.5 mt-1" data-testid="task-schedule-preview-list">
                  {preview.map((iso) => (
                    <li key={iso} className="font-mono text-xs">
                      {new Date(iso).toLocaleString()}{' '}
                      <span className="text-muted-foreground">
                        ({formatDistanceToNow(new Date(iso), { addSuffix: true })})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {formError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={submit.isPending} data-testid={`task-schedule-submit-${mode}`}>
            {submit.isPending ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Save className="size-4 mr-2" />
            )}
            {mode === 'create' ? 'Create schedule' : 'Save changes'}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/tasks">Cancel</Link>
          </Button>
        </div>
      </form>

      {mode === 'edit' && recentRuns && recentRuns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent runs triggered by this schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRuns.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="capitalize">{r.status}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/tasks/${r.id}`} className="text-sm text-primary hover:underline">
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
