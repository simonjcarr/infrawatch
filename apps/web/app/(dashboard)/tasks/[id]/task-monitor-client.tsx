'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format, formatDuration, intervalToDuration } from 'date-fns'
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  RotateCcw,
  SkipForward,
  Terminal,
  AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cancelTaskRun, getTaskRun } from '@/lib/actions/task-runs'
import type { TaskRunWithHosts, TaskRunHostWithHost } from '@/lib/actions/task-runs'
import type {
  PatchTaskResult,
  PatchTaskConfig,
  CustomScriptTaskConfig,
  ServiceTaskConfig,
  ServiceTaskResult,
} from '@/lib/db/schema'

interface Props {
  orgId: string
  initialTaskRun: TaskRunWithHosts
}

const TERMINAL_STATUSES = new Set(['success', 'failed', 'skipped', 'cancelled'])
const RUN_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

function isHostTerminal(status: string) {
  return TERMINAL_STATUSES.has(status)
}

function isRunActive(status: string) {
  return !RUN_TERMINAL_STATUSES.has(status)
}

// ── Status icons ──────────────────────────────────────────────────────────────

function HostStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="size-4 text-green-500 shrink-0" />
    case 'failed':
      return <XCircle className="size-4 text-red-500 shrink-0" />
    case 'running':
      return <Loader2 className="size-4 text-blue-500 animate-spin shrink-0" />
    case 'cancelling':
      return <Loader2 className="size-4 text-orange-400 animate-spin shrink-0" />
    case 'cancelled':
      return <Ban className="size-4 text-orange-500 shrink-0" />
    case 'skipped':
      return <SkipForward className="size-4 text-gray-400 shrink-0" />
    default:
      return <Clock className="size-4 text-gray-400 shrink-0" />
  }
}

function RunStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">Completed</Badge>
    case 'failed':
      return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">Failed</Badge>
    case 'running':
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100"><Loader2 className="size-3 mr-1 animate-spin" />Running</Badge>
    case 'cancelling':
      return <Badge className="bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100"><Loader2 className="size-3 mr-1 animate-spin" />Cancelling…</Badge>
    case 'cancelled':
      return <Badge className="bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100"><Ban className="size-3 mr-1" />Cancelled</Badge>
    default:
      return <Badge className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100"><Clock className="size-3 mr-1" />Pending</Badge>
  }
}

// ── Elapsed time hook ─────────────────────────────────────────────────────────

function useElapsedSeconds(startedAt: Date | null | string | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || !startedAt) return
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [active, startedAt])
  if (!startedAt) return 0
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
}

// ── Output panel ──────────────────────────────────────────────────────────────

function OutputPanel({
  hostRow,
  isLive,
  taskType,
}: {
  hostRow: TaskRunHostWithHost
  isLive: boolean
  taskType: string
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const prevOutputLen = useRef(0)

  const elapsedSecs = useElapsedSeconds(hostRow.startedAt, isLive && hostRow.status === 'running')
  const elapsedMins = Math.floor(elapsedSecs / 60)
  const hasNoOutput = !hostRow.rawOutput
  // Warn if running for > 5 minutes with no output from the command
  const isStuck = isLive && hostRow.status === 'running' && hasNoOutput && elapsedMins >= 5

  // Auto-scroll to bottom when new output arrives and the user hasn't scrolled up.
  useEffect(() => {
    if (!autoScroll) return
    if (hostRow.rawOutput.length !== prevOutputLen.current) {
      prevOutputLen.current = hostRow.rawOutput.length
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [hostRow.rawOutput, autoScroll])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setAutoScroll(atBottom)
  }

  const patchResult = taskType === 'patch' ? (hostRow.result as PatchTaskResult | null) : null
  const serviceResult = taskType === 'service' ? (hostRow.result as ServiceTaskResult | null) : null

  const elapsedLabel =
    elapsedSecs > 0
      ? formatDuration(intervalToDuration({ start: 0, end: elapsedSecs * 1000 }), {
          format: elapsedSecs < 60 ? ['seconds'] : elapsedSecs < 3600 ? ['minutes', 'seconds'] : ['hours', 'minutes'],
        })
      : null

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Output header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-zinc-900 text-zinc-300 text-xs rounded-t-md">
        <Terminal className="size-3.5" />
        <span className="font-mono">{hostRow.host.displayName ?? hostRow.host.hostname}</span>
        {isLive && elapsedLabel && (
          <span className="text-zinc-500 ml-1">({elapsedLabel})</span>
        )}
        {isLive && <span className="ml-auto text-blue-400 animate-pulse">● live</span>}
        {patchResult?.reboot_required && (
          <Badge className="ml-auto bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs">
            <RotateCcw className="size-3 mr-1" />
            Reboot required
          </Badge>
        )}
        {serviceResult !== null && serviceResult !== undefined && (
          <Badge
            className={`ml-auto text-xs ${
              serviceResult.is_active
                ? 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100'
                : 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100'
            }`}
          >
            {serviceResult.is_active ? 'Active' : 'Inactive'}
          </Badge>
        )}
      </div>

      {/* Output log */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-zinc-950 rounded-b-md p-3 font-mono text-xs text-zinc-300 whitespace-pre-wrap"
      >
        {hostRow.status === 'skipped' ? (
          <p className="text-zinc-500 italic">Skipped: {hostRow.skipReason ?? 'no reason given'}</p>
        ) : hostRow.status === 'cancelling' ? (
          <p className="text-zinc-500 italic">
            <Loader2 className="inline size-3.5 mr-1 -mt-0.5 animate-spin text-orange-400" />
            Cancellation requested — waiting for agent to stop the process…
          </p>
        ) : hostRow.status === 'cancelled' && !hostRow.rawOutput ? (
          <p className="text-orange-400 italic">
            <Ban className="inline size-3.5 mr-1 -mt-0.5" />
            Task was cancelled.
          </p>
        ) : hostRow.status === 'pending' ? (
          <p className="text-zinc-500 italic">
            <Clock className="inline size-3.5 mr-1 -mt-0.5" />
            Waiting for agent to pick up task…
          </p>
        ) : hostRow.status === 'running' && hasNoOutput ? (
          <div className="space-y-3">
            <p className="text-zinc-500 italic">
              <Loader2 className="inline size-3.5 mr-1 -mt-0.5 animate-spin" />
              Agent connected — waiting for command output…
              {elapsedLabel && <span className="text-zinc-600"> ({elapsedLabel} elapsed)</span>}
            </p>
            {isStuck && (
              <div className="border border-amber-700 rounded p-2 text-amber-400 not-italic space-y-1">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  No output received for {elapsedMins} minutes
                </p>
                <p className="text-amber-500 text-xs">
                  The patch command may still be starting up, or the agent may have lost its connection.
                  The task will be automatically failed after 60 minutes if no response is received.
                </p>
              </div>
            )}
          </div>
        ) : hostRow.rawOutput ? (
          <>
            {hostRow.rawOutput}
            <div ref={bottomRef} />
          </>
        ) : (
          <p className="text-zinc-500 italic">No output captured.</p>
        )}
      </div>

      {/* Result summary */}
      {patchResult && patchResult.packages_updated && patchResult.packages_updated.length > 0 && (
        <div className="border-t px-3 py-2 bg-muted text-xs">
          <span className="text-muted-foreground">
            {patchResult.packages_updated.length} package{patchResult.packages_updated.length !== 1 ? 's' : ''} updated
          </span>
        </div>
      )}
    </div>
  )
}

// ── Stop button ───────────────────────────────────────────────────────────────

function StopButton({
  orgId,
  taskRunId,
  onCancelled,
}: {
  orgId: string
  taskRunId: string
  onCancelled: () => void
}) {
  const [open, setOpen] = useState(false)
  const mutation = useMutation({
    mutationFn: () => cancelTaskRun(orgId, taskRunId),
    onSuccess: (result) => {
      if ('error' in result) return
      setOpen(false)
      onCancelled()
    },
  })

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-orange-600 border-orange-200 hover:bg-orange-50 hover:text-orange-700"
        >
          <Ban className="size-3.5 mr-1.5" />
          Stop
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop this task run?</AlertDialogTitle>
          <AlertDialogDescription>
            Running hosts will receive a cancellation signal and their processes
            will be stopped. Pending hosts will be cancelled immediately. This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep running</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault()
              mutation.mutate()
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
            Stop task
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TaskMonitorClient({ orgId, initialTaskRun }: Props) {
  const queryClient = useQueryClient()
  const [selectedHostId, setSelectedHostId] = useState<string | null>(
    initialTaskRun.hosts[0]?.hostId ?? null,
  )

  const active = isRunActive(initialTaskRun.status)

  const { data: taskRun = initialTaskRun } = useQuery({
    queryKey: ['task-run', orgId, initialTaskRun.id],
    queryFn: () => getTaskRun(orgId, initialTaskRun.id),
    initialData: initialTaskRun,
    refetchInterval: (query) => {
      const run = query.state.data
      if (!run) return false
      return isRunActive(run.status) ? 3_000 : false
    },
  })

  // Ensure selected host stays valid after data refresh.
  const selectedHost =
    taskRun?.hosts.find((h) => h.hostId === selectedHostId) ??
    taskRun?.hosts[0] ??
    null

  if (!taskRun) return null

  const totalHosts = taskRun.hosts.length
  const doneHosts = taskRun.hosts.filter((h) => isHostTerminal(h.status)).length
  const successHosts = taskRun.hosts.filter((h) => h.status === 'success').length
  const failedHosts = taskRun.hosts.filter((h) => h.status === 'failed').length
  const skippedHosts = taskRun.hosts.filter((h) => h.status === 'skipped').length
  const cancelledHosts = taskRun.hosts.filter(
    (h) => h.status === 'cancelled' || h.status === 'cancelling',
  ).length
  const canStop = taskRun.status === 'pending' || taskRun.status === 'running'
  const rebootRequired =
    taskRun.taskType === 'patch' &&
    taskRun.hosts.some((h) => (h.result as PatchTaskResult | null)?.reboot_required)
  const progressPct = totalHosts > 0 ? Math.round((doneHosts / totalHosts) * 100) : 0

  // Determine back link based on target type.
  const backHref =
    taskRun.targetType === 'group'
      ? `/hosts/groups/${taskRun.targetId}`
      : `/hosts/${taskRun.targetId}`
  const backLabel = taskRun.targetType === 'group' ? 'Back to group' : 'Back to host'

  const taskLabel = (() => {
    if (taskRun.taskType === 'patch') {
      const config = taskRun.config as PatchTaskConfig
      return `Patch — ${config.mode === 'security' ? 'security updates' : 'all updates'}`
    }
    if (taskRun.taskType === 'custom_script') {
      const config = taskRun.config as CustomScriptTaskConfig
      return `Script — ${config.interpreter}`
    }
    if (taskRun.taskType === 'service') {
      const config = taskRun.config as ServiceTaskConfig
      return `Service — ${config.action} ${config.service_name}`
    }
    return taskRun.taskType
  })()

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="size-4" />
          {backLabel}
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{taskLabel}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Started{' '}
              {taskRun.startedAt
                ? formatDistanceToNow(new Date(taskRun.startedAt), { addSuffix: true })
                : format(new Date(taskRun.createdAt), 'PPp')}
              {taskRun.completedAt &&
                ` · completed ${formatDistanceToNow(new Date(taskRun.completedAt), { addSuffix: true })}`}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {rebootRequired && (
              <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
                <RotateCcw className="size-3 mr-1" />
                Reboot required
              </Badge>
            )}
            <RunStatusBadge status={taskRun.status} />
            {canStop && (
              <StopButton
                orgId={orgId}
                taskRunId={taskRun.id}
                onCancelled={() =>
                  queryClient.invalidateQueries({
                    queryKey: ['task-run', orgId, taskRun.id],
                  })
                }
              />
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {doneHosts} / {totalHosts} hosts done
              {successHosts > 0 && ` · ${successHosts} succeeded`}
              {failedHosts > 0 && ` · ${failedHosts} failed`}
              {skippedHosts > 0 && ` · ${skippedHosts} skipped`}
              {cancelledHosts > 0 && ` · ${cancelledHosts} cancelled`}
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 rounded-full"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Split panel */}
      <div className="flex gap-4 flex-1 min-h-0" style={{ height: 'calc(100vh - 280px)' }}>
        {/* Host list */}
        <div className="w-64 shrink-0 rounded-lg border flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b bg-muted/50">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Hosts ({totalHosts})
            </p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y">
            {taskRun.hosts.map((h) => {
              const hostPatchResult = taskRun.taskType === 'patch' ? (h.result as PatchTaskResult | null) : null
              const hostServiceResult = taskRun.taskType === 'service' ? (h.result as ServiceTaskResult | null) : null
              const isSelected = h.hostId === selectedHost?.hostId
              return (
                <button
                  key={h.id}
                  onClick={() => setSelectedHostId(h.hostId)}
                  className={`w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-muted/50 transition-colors ${
                    isSelected ? 'bg-muted' : ''
                  }`}
                >
                  <HostStatusIcon status={h.status} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {h.host.displayName ?? h.host.hostname}
                    </p>
                    {h.host.displayName && (
                      <p className="text-xs text-muted-foreground truncate">{h.host.hostname}</p>
                    )}
                    {hostPatchResult?.reboot_required && (
                      <p className="text-xs text-amber-600 flex items-center gap-0.5 mt-0.5">
                        <RotateCcw className="size-2.5" />
                        Reboot required
                      </p>
                    )}
                    {hostServiceResult !== null && hostServiceResult !== undefined && (
                      <p className={`text-xs mt-0.5 ${hostServiceResult.is_active ? 'text-green-600' : 'text-red-500'}`}>
                        {hostServiceResult.is_active ? 'Active' : 'Inactive'}
                      </p>
                    )}
                    {h.status === 'skipped' && (
                      <p className="text-xs text-muted-foreground mt-0.5">Skipped</p>
                    )}
                    {h.exitCode !== null && h.exitCode !== undefined && h.status !== 'success' && (
                      <p className="text-xs text-red-500 mt-0.5">Exit code: {h.exitCode}</p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Output panel */}
        <div className="flex-1 min-w-0 rounded-lg border overflow-hidden flex flex-col">
          {selectedHost ? (
            <OutputPanel
              hostRow={selectedHost}
              isLive={!isHostTerminal(selectedHost.status) && active}
              taskType={taskRun.taskType}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a host to view output
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
