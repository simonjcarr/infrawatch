'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  FileText,
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  Package,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  listAutomatedRunsForHost,
  deleteTaskRuns,
} from '@/lib/actions/task-runs'
import type { TaskRunWithHosts } from '@/lib/actions/task-runs'
import type { SoftwareInventoryTaskResult } from '@/lib/db/schema'

interface Props {
  orgId: string
  hostId: string
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

function taskTypeLabel(taskType: string): string {
  switch (taskType) {
    case 'software_inventory': return 'Software inventory'
    default: return taskType.replace(/_/g, ' ')
  }
}

function LogDetailsCell({ run, hostId }: { run: TaskRunWithHosts; hostId: string }) {
  const thisHost = run.hosts.find((h) => h.hostId === hostId)

  if (run.taskType === 'software_inventory') {
    const result = thisHost?.result as SoftwareInventoryTaskResult | null
    if (!result) {
      return <span className="text-sm text-muted-foreground">—</span>
    }
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Package className="size-3.5" />
        <span>
          {result.package_count.toLocaleString()} packages
        </span>
        <span className="text-xs">·</span>
        <span className="font-mono text-xs">{result.source}</span>
      </div>
    )
  }

  return <span className="text-sm text-muted-foreground">—</span>
}

export function LogsTab({ orgId, hostId }: Props) {
  const queryClient = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data: runs = [] } = useQuery({
    queryKey: ['automated-runs-host', orgId, hostId],
    queryFn: () => listAutomatedRunsForHost(orgId, hostId),
    refetchInterval: (query) => {
      const rows = query.state.data ?? []
      return rows.some((r) => isRunActive(r.status)) ? 5_000 : 30_000
    },
  })

  const { mutate: doDelete, isPending: isDeleting } = useMutation({
    mutationFn: () => deleteTaskRuns(orgId, [...selectedIds]),
    onSuccess: () => {
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['automated-runs-host', orgId, hostId] })
    },
  })

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === runs.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(runs.map((r) => r.id)))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground" data-testid="host-logs-heading">Automated Logs</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Runs started automatically by the system — e.g. periodic software inventory scans.
        </p>
      </div>

      {selectedIds.size > 0 && (
        <div
          className="flex items-center justify-between rounded-lg border bg-muted/50 px-3 py-2"
          data-testid="host-logs-selection"
        >
          <span className="text-sm text-muted-foreground">
            {selectedIds.size} selected
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => doDelete()}
            disabled={isDeleting}
            data-testid="host-logs-delete-selected"
          >
            {isDeleting ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5 mr-1.5" />
            )}
            Delete {selectedIds.size}
          </Button>
        </div>
      )}

      {runs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" data-testid="host-logs-empty">
          <FileText className="size-7 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">No automated runs yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Automated runs will appear here after the system schedules its next scan.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={runs.length > 0 && selectedIds.size === runs.length}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow
                  key={run.id}
                  data-state={selectedIds.has(run.id) ? 'selected' : undefined}
                  data-testid={`host-log-row-${run.id}`}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(run.id)}
                      onCheckedChange={() => toggleSelect(run.id)}
                      aria-label={`Select run ${run.id}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {taskTypeLabel(run.taskType)}
                  </TableCell>
                  <TableCell>
                    <LogDetailsCell run={run} hostId={hostId} />
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={run.status} />
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
