'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Plus, Play, Pencil, Trash2, Loader2, Server, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  listSchedules,
  setScheduleEnabled,
  deleteSchedule,
  runScheduleNow,
} from '@/lib/actions/task-schedules'
import type { ScheduleWithTargetName } from '@/lib/actions/task-schedules-types'

const TASK_TYPE_LABELS: Record<string, string> = {
  patch: 'Patch',
  custom_script: 'Custom script',
  service: 'Service action',
  software_inventory: 'Software inventory',
}

function formatMaybeDate(d: Date | string | null): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return formatDistanceToNow(date, { addSuffix: true })
}

export function SchedulesClient({
  orgId,
  userRole,
  initialSchedules,
}: {
  orgId: string
  userRole: string
  initialSchedules: ScheduleWithTargetName[]
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState<ScheduleWithTargetName | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const canEdit = userRole !== 'read_only'

  const { data: schedules = initialSchedules } = useQuery({
    queryKey: ['task-schedules', orgId],
    queryFn: () => listSchedules(orgId),
    initialData: initialSchedules,
    staleTime: 10_000,
  })

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setScheduleEnabled(orgId, id, enabled),
    onSuccess: (result) => {
      if ('error' in result) setErrorMsg(result.error)
      queryClient.invalidateQueries({ queryKey: ['task-schedules', orgId] })
    },
  })

  const runNow = useMutation({
    mutationFn: (id: string) => runScheduleNow(orgId, id),
    onSuccess: (result) => {
      if ('error' in result) {
        setErrorMsg(result.error)
        return
      }
      router.push(`/tasks/${result.taskRunId}`)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteSchedule(orgId, id),
    onSuccess: (result) => {
      if ('error' in result) setErrorMsg(result.error)
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['task-schedules', orgId] })
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid="task-schedules-heading">Scheduled Tasks</h1>
          <p className="text-muted-foreground mt-1">
            Run patches, custom scripts, service actions, and inventory scans on a recurring cadence.
          </p>
        </div>
        {canEdit && (
          <Button asChild>
            <Link href="/tasks/schedules/new">
              <Plus className="size-4 mr-2" />
              New schedule
            </Link>
          </Button>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      {schedules.length === 0 ? (
        <Card data-testid="task-schedules-empty">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No schedules yet.
              {canEdit && (
                <>
                  {' '}
                  <Link className="text-primary underline" href="/tasks/schedules/new">
                    Create your first schedule
                  </Link>
                  .
                </>
              )}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Cron</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.map((s) => (
                <TableRow key={s.id} data-testid={`task-schedule-row-${s.id}`}>
                  <TableCell>
                    <Link href={`/tasks/schedules/${s.id}`} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                    {s.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                    )}
                  </TableCell>
                  <TableCell>{TASK_TYPE_LABELS[s.taskType] ?? s.taskType}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      {s.targetType === 'host' ? (
                        <Server className="size-3.5 text-muted-foreground" />
                      ) : (
                        <Layers className="size-3.5 text-muted-foreground" />
                      )}
                      {s.targetName ?? <span className="text-muted-foreground">(deleted)</span>}
                    </span>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{s.cronExpression}</code>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.timezone}</p>
                  </TableCell>
                  <TableCell className="text-sm">{formatMaybeDate(s.nextRunAt)}</TableCell>
                  <TableCell className="text-sm">
                    {s.lastRunTaskRunId ? (
                      <Link href={`/tasks/${s.lastRunTaskRunId}`} className="hover:underline">
                        {formatMaybeDate(s.lastRunAt)}
                      </Link>
                    ) : (
                      formatMaybeDate(s.lastRunAt)
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      data-testid={`task-schedule-toggle-${s.id}`}
                      checked={s.enabled}
                      disabled={!canEdit || toggle.isPending}
                      onCheckedChange={(checked) => toggle.mutate({ id: s.id, enabled: checked })}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {canEdit && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Run now"
                            disabled={runNow.isPending}
                            onClick={() => runNow.mutate(s.id)}
                          >
                            {runNow.isPending && runNow.variables === s.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Play className="size-4" />
                            )}
                          </Button>
                          <Button variant="ghost" size="icon" title="Edit" asChild>
                            <Link href={`/tasks/schedules/${s.id}`}>
                              <Pencil className="size-4" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            data-testid={`task-schedule-delete-${s.id}`}
                            onClick={() => setDeleteTarget(s)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.name}&quot; will no longer run. Existing task runs triggered by this
              schedule remain viewable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="task-schedule-delete-confirm"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
              disabled={remove.isPending}
            >
              {remove.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Trash2 className="size-4 mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
