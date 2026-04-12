'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
  Terminal,
  Power,
  AlertTriangle,
  Trash2,
  Search,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  triggerPatchRun,
  triggerCustomScriptRun,
  triggerServiceAction,
  listTaskRunsForHost,
  deleteTaskRuns,
} from '@/lib/actions/task-runs'
import type { TaskRunWithHosts } from '@/lib/actions/task-runs'
import type {
  PatchTaskConfig,
  PatchTaskResult,
  CustomScriptTaskConfig,
  ServiceTaskConfig,
  ServiceTaskResult,
  AgentQueryStatus,
  ServiceInfoResult,
} from '@/lib/db/schema'
import type { HostWithAgent } from '@/lib/actions/agents'
import { useRouter } from 'next/navigation'

interface Props {
  orgId: string
  host: HostWithAgent
  userId: string
}

type AgentQueryPollResponse = {
  status: AgentQueryStatus
  result?: { services?: ServiceInfoResult[] }
  error?: string
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
    case 'patch': return 'Patch'
    case 'custom_script': return 'Script'
    case 'service': return 'Service'
    default: return taskType
  }
}

function TaskDetailsCell({ run, hostId }: { run: TaskRunWithHosts; hostId: string }) {
  const thisHost = run.hosts.find((h) => h.hostId === hostId)

  if (run.taskType === 'patch') {
    const config = run.config as PatchTaskConfig
    const result = thisHost?.result as PatchTaskResult | null
    return (
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {config.mode === 'security' ? 'Security only' : 'All updates'}
        </p>
        {result?.reboot_required && (
          <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs">
            <RotateCcw className="size-3 mr-1" />
            Reboot req.
          </Badge>
        )}
      </div>
    )
  }

  if (run.taskType === 'custom_script') {
    const config = run.config as CustomScriptTaskConfig
    return <span className="text-sm text-muted-foreground">{config.interpreter}</span>
  }

  if (run.taskType === 'service') {
    const config = run.config as ServiceTaskConfig
    const result = thisHost?.result as ServiceTaskResult | null
    return (
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground capitalize">
          {config.action} · {config.service_name}
        </p>
        {result !== null && result !== undefined && (
          <Badge
            className={
              result.is_active
                ? 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-xs'
                : 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-xs'
            }
          >
            {result.is_active ? 'Active' : 'Inactive'}
          </Badge>
        )}
      </div>
    )
  }

  return <span className="text-sm text-muted-foreground">—</span>
}

export function TasksTab({ orgId, host, userId }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const isLinux = host.os?.toLowerCase() === 'linux'

  // Patch dialog state
  const [patchOpen, setPatchOpen] = useState(false)
  const [patchMode, setPatchMode] = useState<'all' | 'security'>('all')

  // Script dialog state
  const [scriptOpen, setScriptOpen] = useState(false)
  const [scriptBody, setScriptBody] = useState('')
  const [interpreter, setInterpreter] = useState<'sh' | 'bash' | 'python3'>('sh')

  // Service dialog state
  const [serviceOpen, setServiceOpen] = useState(false)
  const [serviceName, setServiceName] = useState('')
  const [serviceAction, setServiceAction] = useState<'start' | 'stop' | 'restart' | 'status'>('restart')
  const [svcQueryId, setSvcQueryId] = useState<string | null>(null)
  const [svcQueryError, setSvcQueryError] = useState<string | null>(null)

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data: taskRuns = [] } = useQuery({
    queryKey: ['task-runs-host', orgId, host.id],
    queryFn: () => listTaskRunsForHost(orgId, host.id),
    refetchInterval: (query) => {
      const runs = query.state.data ?? []
      return runs.some((r) => isRunActive(r.status)) ? 5_000 : 30_000
    },
  })

  // Service autocomplete query polling
  const { data: svcQueryData } = useQuery<AgentQueryPollResponse>({
    queryKey: ['agent-query', host.id, svcQueryId],
    queryFn: async () => {
      const res = await fetch(`/api/hosts/${host.id}/queries/${svcQueryId}`)
      return res.json()
    },
    enabled: svcQueryId !== null,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'complete' || s === 'error' ? false : 1_000
    },
  })

  async function querySvcServices() {
    setSvcQueryId(null)
    setSvcQueryError(null)
    const res = await fetch(`/api/hosts/${host.id}/queries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryType: 'list_services' }),
    })
    const data = await res.json()
    if (!res.ok) {
      setSvcQueryError(data.error ?? 'Failed to query services')
      return
    }
    setSvcQueryId(data.id)
  }

  const { mutate: doPatchRun, isPending: isPatching } = useMutation({
    mutationFn: () => triggerPatchRun(orgId, userId, host.id, patchMode),
    onSuccess: (result) => {
      setPatchOpen(false)
      if ('taskRunId' in result) router.push(`/tasks/${result.taskRunId}`)
    },
  })

  const { mutate: doScriptRun, isPending: isScripting } = useMutation({
    mutationFn: () => triggerCustomScriptRun(orgId, userId, host.id, scriptBody, interpreter),
    onSuccess: (result) => {
      setScriptOpen(false)
      if ('taskRunId' in result) router.push(`/tasks/${result.taskRunId}`)
    },
  })

  const { mutate: doServiceAction, isPending: isServicing } = useMutation({
    mutationFn: () => triggerServiceAction(orgId, userId, host.id, serviceName, serviceAction),
    onSuccess: (result) => {
      setServiceOpen(false)
      if ('taskRunId' in result) router.push(`/tasks/${result.taskRunId}`)
    },
  })

  const { mutate: doDelete, isPending: isDeleting } = useMutation({
    mutationFn: () => deleteTaskRuns(orgId, [...selectedIds]),
    onSuccess: () => {
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['task-runs-host', orgId, host.id] })
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
    if (selectedIds.size === taskRuns.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(taskRuns.map((r) => r.id)))
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Task Runs</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Run operations against this host.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setScriptOpen(true)}>
            <Terminal className="size-4 mr-1.5" />
            Run Script
          </Button>
          {isLinux && (
            <>
              <Button variant="outline" size="sm" onClick={() => setServiceOpen(true)}>
                <Power className="size-4 mr-1.5" />
                Service
              </Button>
              <Button size="sm" onClick={() => setPatchOpen(true)}>
                <Shield className="size-4 mr-1.5" />
                Run Patch
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Selection toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-3 py-2">
          <span className="text-sm text-muted-foreground">
            {selectedIds.size} selected
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => doDelete()}
            disabled={isDeleting}
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

      {/* Task run history */}
      {taskRuns.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <RefreshCw className="size-7 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">No task runs yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Use the buttons above to run a task on this host.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={taskRuns.length > 0 && selectedIds.size === taskRuns.length}
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
              {taskRuns.map((run) => (
                <TableRow key={run.id} data-state={selectedIds.has(run.id) ? 'selected' : undefined}>
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
                    <TaskDetailsCell run={run} hostId={host.id} />
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
            <Button variant="outline" onClick={() => setPatchOpen(false)}>Cancel</Button>
            <Button onClick={() => doPatchRun()} disabled={isPatching}>
              {isPatching && <Loader2 className="size-4 mr-1 animate-spin" />}
              Run Patch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Script dialog */}
      <Dialog open={scriptOpen} onOpenChange={setScriptOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Run Script</DialogTitle>
            <DialogDescription>
              Write a script to execute on this host. Output is streamed in real time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Interpreter</Label>
              <div className="flex gap-2">
                {(['sh', 'bash', 'python3'] as const).map((i) => (
                  <button
                    key={i}
                    onClick={() => setInterpreter(i)}
                    className={`rounded-md border px-3 py-1.5 text-sm font-mono transition-colors ${
                      interpreter === i
                        ? 'border-primary bg-primary/5 text-foreground font-medium'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40'
                    }`}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Script</Label>
              <Textarea
                placeholder={`#!/bin/${interpreter}\necho "Hello from $(hostname)"`}
                value={scriptBody}
                onChange={(e) => setScriptBody(e.target.value)}
                className="font-mono text-xs min-h-36 resize-y"
                rows={8}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setScriptOpen(false)}>Cancel</Button>
            <Button onClick={() => doScriptRun()} disabled={isScripting || !scriptBody.trim()}>
              {isScripting && <Loader2 className="size-4 mr-1 animate-spin" />}
              Run Script
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Service dialog */}
      <Dialog
        open={serviceOpen}
        onOpenChange={(open) => {
          setServiceOpen(open)
          if (!open) {
            setSvcQueryId(null)
            setSvcQueryError(null)
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Service Action</DialogTitle>
            <DialogDescription>
              Run a systemctl command against a service on this host.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Service name</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. nginx, postgresql, ssh"
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={querySvcServices}
                  disabled={svcQueryId !== null && svcQueryData?.status !== 'complete' && svcQueryData?.status !== 'error'}
                  title="Query running services from the host"
                >
                  {svcQueryId !== null && svcQueryData?.status !== 'complete' && svcQueryData?.status !== 'error' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                </Button>
              </div>
              {svcQueryError && (
                <p className="text-xs text-destructive">{svcQueryError}</p>
              )}
              {svcQueryData?.status === 'complete' && svcQueryData.result?.services && svcQueryData.result.services.length > 0 && (
                <div className="rounded-md border bg-muted/50 max-h-48 overflow-y-auto divide-y">
                  {svcQueryData.result.services.map((s) => (
                    <button
                      key={s.name}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                      onClick={() => {
                        setServiceName(s.name.replace(/\.service$/, ''))
                        setSvcQueryId(null)
                      }}
                    >
                      <span className="font-mono text-foreground">{s.name.replace(/\.service$/, '')}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{s.active_sub}</span>
                    </button>
                  ))}
                </div>
              )}
              {svcQueryData?.status === 'error' && (
                <p className="text-xs text-destructive">
                  {svcQueryData.error ?? 'Failed to query services'}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Action</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: 'start', desc: 'Start the service' },
                    { value: 'stop', desc: 'Stop the service' },
                    { value: 'restart', desc: 'Restart the service' },
                    { value: 'status', desc: 'Check current status' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setServiceAction(opt.value)}
                    className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
                      serviceAction === opt.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/40'
                    }`}
                  >
                    <p className="text-sm font-medium text-foreground capitalize">{opt.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            {!isLinux && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
                <AlertTriangle className="size-3.5 inline mr-1" />
                Service management requires systemctl (Linux only).
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setServiceOpen(false)}>Cancel</Button>
            <Button
              onClick={() => doServiceAction()}
              disabled={isServicing || !serviceName.trim()}
            >
              {isServicing && <Loader2 className="size-4 mr-1 animate-spin" />}
              Run Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
