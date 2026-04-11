'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  Shield,
  RefreshCw,
  ExternalLink,
  Loader2,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { triggerPatchRun, listTaskRunsForHost } from '@/lib/actions/task-runs'
import type { TaskRunWithHosts } from '@/lib/actions/task-runs'
import type { PatchTaskConfig, PatchTaskResult } from '@/lib/db/schema'
import type { HostWithAgent } from '@/lib/actions/agents'
import { useRouter } from 'next/navigation'

interface Props {
  orgId: string
  host: HostWithAgent
  userId: string
}

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed'])

function isRunActive(status: string) {
  return !TERMINAL_RUN_STATUSES.has(status)
}

function RunStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
          <CheckCircle2 className="size-3 mr-1" />
          Completed
        </Badge>
      )
    case 'failed':
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
          <XCircle className="size-3 mr-1" />
          Failed
        </Badge>
      )
    case 'running':
      return (
        <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">
          <Loader2 className="size-3 mr-1 animate-spin" />
          Running
        </Badge>
      )
    default:
      return (
        <Badge className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">
          <Clock className="size-3 mr-1" />
          Pending
        </Badge>
      )
  }
}

export function TasksTab({ orgId, host, userId }: Props) {
  const router = useRouter()
  const [patchOpen, setPatchOpen] = useState(false)
  const [patchMode, setPatchMode] = useState<'all' | 'security'>('all')

  const isLinux = host.os?.toLowerCase() === 'linux'

  const { data: taskRuns = [] } = useQuery({
    queryKey: ['task-runs-host', orgId, host.id],
    queryFn: () => listTaskRunsForHost(orgId, host.id),
    refetchInterval: (query) => {
      const runs = query.state.data ?? []
      return runs.some((r) => isRunActive(r.status)) ? 5_000 : 30_000
    },
  })

  const { mutate: doPatchRun, isPending: isPatching } = useMutation({
    mutationFn: () => triggerPatchRun(orgId, userId, host.id, patchMode),
    onSuccess: (result) => {
      setPatchOpen(false)
      if ('taskRunId' in result) {
        router.push(`/tasks/${result.taskRunId}`)
      }
    },
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Task Runs</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Run built-in operations against this host.
          </p>
        </div>
        {isLinux && (
          <Button onClick={() => setPatchOpen(true)} size="sm">
            <Shield className="size-4 mr-1.5" />
            Run Patch
          </Button>
        )}
      </div>

      {/* Non-Linux notice */}
      {!isLinux && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Shield className="size-7 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">Task execution not supported</p>
          <p className="text-xs text-muted-foreground mt-1">
            Built-in tasks such as patching are only available on Linux hosts.
            {host.os ? ` This host is running ${host.os}.` : ''}
          </p>
        </div>
      )}

      {/* Task run history */}
      {isLinux && (
        <>
          {taskRuns.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <RefreshCw className="size-7 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">No task runs yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Run Patch to start the first task run on this host.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reboot</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taskRuns.map((run) => {
                    const config = run.config as PatchTaskConfig
                    const thisHost = run.hosts.find((h) => h.hostId === host.id)
                    const result = thisHost?.result as PatchTaskResult | null
                    const rebootRequired = result?.reboot_required ?? false

                    return (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium capitalize">
                          {run.taskType === 'patch' ? 'Patch' : run.taskType}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground capitalize">
                          {config.mode === 'security' ? 'Security only' : 'All updates'}
                        </TableCell>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell>
                          {rebootRequired ? (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs">
                              <RotateCcw className="size-3 mr-1" />
                              Required
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {run.startedAt
                            ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })
                            : formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell>
                          <Link href={`/tasks/${run.id}`}>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                              {isRunActive(run.status) ? 'View live' : 'View'}
                              <ExternalLink className="size-3" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {/* Patch dialog */}
      <Dialog open={patchOpen} onOpenChange={setPatchOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Run Patch</DialogTitle>
            <DialogDescription>
              Select the patch mode. The agent will detect your package manager (apt / dnf / yum /
              zypper) and run the appropriate update command.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label className="text-sm font-medium">Patch mode</Label>
            <div className="space-y-2">
              {(
                [
                  { value: 'all', label: 'All updates', desc: 'Full system upgrade' },
                  { value: 'security', label: 'Security updates only', desc: 'Security-flagged packages only' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPatchMode(opt.value)}
                  className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                    patchMode === opt.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/40'
                  }`}
                >
                  <p className="text-sm font-medium text-foreground">{opt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPatchOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => doPatchRun()} disabled={isPatching}>
              {isPatching && <Loader2 className="size-4 mr-1 animate-spin" />}
              Run Patch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
