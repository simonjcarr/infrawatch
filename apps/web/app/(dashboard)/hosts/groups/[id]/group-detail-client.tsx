'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  Server,
  CheckCircle,
  WifiOff,
  AlertTriangle,
  Clock,
  Search,
  Shield,
  CheckCircle2,
  XCircle,
  ExternalLink,
  RotateCcw,
  SkipForward,
  Terminal,
  Power,
} from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getGroup,
  addHostToGroup,
  removeHostFromGroup,
} from '@/lib/actions/host-groups'
import { listHosts } from '@/lib/actions/agents'
import {
  triggerGroupPatchRun,
  triggerGroupCustomScriptRun,
  triggerGroupServiceAction,
  listTaskRunsForGroup,
  deleteTaskRuns,
} from '@/lib/actions/task-runs'
import type { HostGroupWithMembers } from '@/lib/actions/host-groups'
import type { HostWithAgent } from '@/lib/actions/agents'
import type { TaskRunWithHosts } from '@/lib/actions/task-runs'
import type {
  Host,
  PatchTaskConfig,
  CustomScriptTaskConfig,
  ServiceTaskConfig,
  ServiceTaskResult,
} from '@/lib/db/schema'

const PARALLEL_OPTIONS = [
  { value: 1, label: '1 (sequential)' },
  { value: 2, label: '2' },
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 0, label: 'Unlimited' },
]

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed'])

function isRunActive(status: string) {
  return !TERMINAL_RUN_STATUSES.has(status)
}

interface Props {
  orgId: string
  userId: string
  initialGroup: HostGroupWithMembers
  initialAllHosts: HostWithAgent[]
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'online':
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
          <CheckCircle className="size-3 mr-1" />
          Online
        </Badge>
      )
    case 'offline':
      return (
        <Badge className="bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100">
          <WifiOff className="size-3 mr-1" />
          Offline
        </Badge>
      )
    case 'pending':
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
          <Clock className="size-3 mr-1" />
          Pending
        </Badge>
      )
    default:
      return (
        <Badge className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">
          <AlertTriangle className="size-3 mr-1" />
          Unknown
        </Badge>
      )
  }
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

export function GroupDetailClient({ orgId, userId, initialGroup, initialAllHosts }: Props) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [removeTarget, setRemoveTarget] = useState<Host | null>(null)

  // Patch dialog state
  const [patchOpen, setPatchOpen] = useState(false)
  const [patchMode, setPatchMode] = useState<'all' | 'security'>('all')
  const [maxParallel, setMaxParallel] = useState(1)

  // Script dialog state
  const [scriptOpen, setScriptOpen] = useState(false)
  const [scriptBody, setScriptBody] = useState('')
  const [interpreter, setInterpreter] = useState<'sh' | 'bash' | 'python3'>('sh')
  const [scriptMaxParallel, setScriptMaxParallel] = useState(1)

  // Service dialog state
  const [serviceOpen, setServiceOpen] = useState(false)
  const [serviceName, setServiceName] = useState('')
  const [serviceAction, setServiceAction] = useState<'start' | 'stop' | 'restart' | 'status'>('restart')
  const [serviceMaxParallel, setServiceMaxParallel] = useState(1)

  // Selection state for task history
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set())

  const { data: group } = useQuery({
    queryKey: ['host-group', orgId, initialGroup.id],
    queryFn: () => getGroup(orgId, initialGroup.id),
    initialData: initialGroup,
    refetchInterval: 30_000,
  })

  const { data: allHosts = initialAllHosts } = useQuery({
    queryKey: ['hosts', orgId],
    queryFn: () => listHosts(orgId),
    initialData: initialAllHosts,
    enabled: addOpen,
  })

  const { data: taskRuns = [] } = useQuery({
    queryKey: ['task-runs-group', orgId, initialGroup.id],
    queryFn: () => listTaskRunsForGroup(orgId, initialGroup.id),
    refetchInterval: (query) => {
      const runs = query.state.data ?? []
      return runs.some((r) => isRunActive(r.status)) ? 5_000 : 30_000
    },
  })

  const { mutate: doAdd, isPending: isAdding } = useMutation({
    mutationFn: (hostId: string) => addHostToGroup(orgId, group!.id, hostId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['host-group', orgId, initialGroup.id] })
      queryClient.invalidateQueries({ queryKey: ['host-groups', orgId] })
    },
  })

  const { mutate: doRemove, isPending: isRemoving } = useMutation({
    mutationFn: (hostId: string) => removeHostFromGroup(orgId, group!.id, hostId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['host-group', orgId, initialGroup.id] })
      queryClient.invalidateQueries({ queryKey: ['host-groups', orgId] })
      setRemoveTarget(null)
    },
  })

  const { mutate: doPatchGroup, isPending: isPatching } = useMutation({
    mutationFn: () =>
      triggerGroupPatchRun(orgId, userId, initialGroup.id, patchMode, maxParallel),
    onSuccess: (result) => {
      setPatchOpen(false)
      if ('taskRunId' in result) router.push(`/tasks/${result.taskRunId}`)
    },
  })

  const { mutate: doGroupScript, isPending: isScripting } = useMutation({
    mutationFn: () =>
      triggerGroupCustomScriptRun(orgId, userId, initialGroup.id, scriptBody, interpreter, scriptMaxParallel),
    onSuccess: (result) => {
      setScriptOpen(false)
      if ('taskRunId' in result) router.push(`/tasks/${result.taskRunId}`)
    },
  })

  const { mutate: doGroupService, isPending: isServicing } = useMutation({
    mutationFn: () =>
      triggerGroupServiceAction(orgId, userId, initialGroup.id, serviceName, serviceAction, serviceMaxParallel),
    onSuccess: (result) => {
      setServiceOpen(false)
      if ('taskRunId' in result) router.push(`/tasks/${result.taskRunId}`)
    },
  })

  const { mutate: doDeleteRuns, isPending: isDeletingRuns } = useMutation({
    mutationFn: () => deleteTaskRuns(orgId, [...selectedRunIds]),
    onSuccess: () => {
      setSelectedRunIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['task-runs-group', orgId, initialGroup.id] })
    },
  })

  if (!group) return null

  const memberIds = new Set(group.members.map((h) => h.id))
  const nonLinuxCount = group.members.filter((h) => h.os?.toLowerCase() !== 'linux').length
  const linuxCount = group.members.length - nonLinuxCount

  const filteredSearch = allHosts.filter((h) => {
    if (memberIds.has(h.id)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      h.hostname.toLowerCase().includes(q) ||
      (h.displayName ?? '').toLowerCase().includes(q) ||
      (h.os ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/hosts/groups"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="size-4" />
          Back to groups
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{group.name}</h1>
            {group.description && (
              <p className="text-sm text-muted-foreground mt-1">{group.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setScriptOpen(true)}>
              <Terminal className="size-4 mr-1" />
              Run Script
            </Button>
            <Button variant="outline" onClick={() => setServiceOpen(true)}>
              <Power className="size-4 mr-1" />
              Service Action
            </Button>
            <Button variant="outline" onClick={() => setPatchOpen(true)}>
              <Shield className="size-4 mr-1" />
              Patch Group
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4 mr-1" />
              Add Hosts
            </Button>
          </div>
        </div>
      </div>

      {/* Members table */}
      {group.members.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Server className="size-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">No hosts in this group</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add hosts to this group to target them in batch operations.
          </p>
          <Button className="mt-4" onClick={() => setAddOpen(true)}>
            <Plus className="size-4 mr-1" />
            Add Hosts
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hostname</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.members.map((host) => (
                <TableRow key={host.id}>
                  <TableCell>
                    <Link
                      href={`/hosts/${host.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {host.displayName ?? host.hostname}
                    </Link>
                    {host.displayName && (
                      <p className="text-xs text-muted-foreground">{host.hostname}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {host.os ? `${host.os} ${host.osVersion ?? ''}`.trim() : '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={host.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {host.lastSeenAt
                      ? formatDistanceToNow(new Date(host.lastSeenAt), { addSuffix: true })
                      : 'Never'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => setRemoveTarget(host)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Task History */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Task History</h2>

        {/* Selection toolbar */}
        {selectedRunIds.size > 0 && (
          <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-3 py-2">
            <span className="text-sm text-muted-foreground">
              {selectedRunIds.size} selected
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => doDeleteRuns()}
              disabled={isDeletingRuns}
            >
              {isDeletingRuns ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5 mr-1.5" />
              )}
              Delete {selectedRunIds.size}
            </Button>
          </div>
        )}

        {taskRuns.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Terminal className="size-7 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">No task runs yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use the buttons above to run a task on this group.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={taskRuns.length > 0 && selectedRunIds.size === taskRuns.length}
                      onCheckedChange={() => {
                        if (selectedRunIds.size === taskRuns.length) {
                          setSelectedRunIds(new Set())
                        } else {
                          setSelectedRunIds(new Set(taskRuns.map((r) => r.id)))
                        }
                      }}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hosts</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {taskRuns.map((run) => {
                  const successCount = run.hosts.filter((h) => h.status === 'success').length
                  const failedCount = run.hosts.filter((h) => h.status === 'failed').length
                  const skippedCount = run.hosts.filter((h) => h.status === 'skipped').length
                  const runningCount = run.hosts.filter((h) => h.status === 'running').length
                  const pendingCount = run.hosts.filter((h) => h.status === 'pending').length

                  return (
                    <TableRow key={run.id} data-state={selectedRunIds.has(run.id) ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selectedRunIds.has(run.id)}
                          onCheckedChange={() => {
                            setSelectedRunIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(run.id)) next.delete(run.id)
                              else next.add(run.id)
                              return next
                            })
                          }}
                          aria-label={`Select run ${run.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {run.taskType === 'patch' ? 'Patch'
                          : run.taskType === 'custom_script' ? 'Script'
                          : run.taskType === 'service' ? 'Service'
                          : run.taskType}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {run.taskType === 'patch' && (() => {
                          const config = run.config as PatchTaskConfig
                          const rebootCount = run.hosts.filter(
                            (h) => (h.result as { reboot_required?: boolean } | null)?.reboot_required,
                          ).length
                          return (
                            <div className="space-y-1">
                              <p>{config.mode === 'security' ? 'Security only' : 'All updates'}</p>
                              {rebootCount > 0 && (
                                <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs">
                                  <RotateCcw className="size-3 mr-1" />
                                  {rebootCount} reboot{rebootCount !== 1 ? 's' : ''}
                                </Badge>
                              )}
                            </div>
                          )
                        })()}
                        {run.taskType === 'custom_script' && (
                          (run.config as CustomScriptTaskConfig).interpreter
                        )}
                        {run.taskType === 'service' && (() => {
                          const config = run.config as ServiceTaskConfig
                          const activeCount = run.hosts.filter(
                            (h) => (h.result as ServiceTaskResult | null)?.is_active,
                          ).length
                          const doneCount = run.hosts.filter(
                            (h) => h.status === 'success' || h.status === 'failed',
                          ).length
                          return (
                            <div className="space-y-1">
                              <p className="capitalize">{config.action} · {config.service_name}</p>
                              {doneCount > 0 && (
                                <p className="text-xs">
                                  <span className="text-green-700">{activeCount} active</span>
                                  {doneCount - activeCount > 0 && (
                                    <span className="text-muted-foreground"> · {doneCount - activeCount} inactive</span>
                                  )}
                                </p>
                              )}
                            </div>
                          )
                        })()}
                      </TableCell>
                      <TableCell>
                        <RunStatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="space-y-0.5">
                          {successCount > 0 && (
                            <div className="text-green-700">{successCount} succeeded</div>
                          )}
                          {failedCount > 0 && (
                            <div className="text-red-600">{failedCount} failed</div>
                          )}
                          {runningCount > 0 && (
                            <div className="text-blue-600">{runningCount} running</div>
                          )}
                          {pendingCount > 0 && (
                            <div className="text-muted-foreground">{pendingCount} pending</div>
                          )}
                          {skippedCount > 0 && (
                            <div className="text-muted-foreground flex items-center gap-0.5">
                              <SkipForward className="size-3" />
                              {skippedCount} skipped
                            </div>
                          )}
                        </div>
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
      </div>

      {/* Script Group Dialog */}
      <Dialog open={scriptOpen} onOpenChange={setScriptOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Run Script on &quot;{group.name}&quot;</DialogTitle>
            <DialogDescription>
              Execute a script on all hosts in this group. Output is streamed in real time.
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
            <div className="space-y-2">
              <Label className="text-sm font-medium">Max parallel hosts</Label>
              <div className="flex flex-wrap gap-2">
                {PARALLEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setScriptMaxParallel(opt.value)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      scriptMaxParallel === opt.value
                        ? 'border-primary bg-primary/5 text-foreground font-medium'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setScriptOpen(false)}>Cancel</Button>
            <Button onClick={() => doGroupScript()} disabled={isScripting || !scriptBody.trim()}>
              {isScripting && <Loader2 className="size-4 mr-1 animate-spin" />}
              Run Script
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Service Group Dialog */}
      <Dialog open={serviceOpen} onOpenChange={setServiceOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Service Action on &quot;{group.name}&quot;</DialogTitle>
            <DialogDescription>
              Run a systemctl command against Linux hosts in this group.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Service name</Label>
              <Input
                placeholder="e.g. nginx, postgresql, ssh"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
              />
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
            <div className="space-y-2">
              <Label className="text-sm font-medium">Max parallel hosts</Label>
              <div className="flex flex-wrap gap-2">
                {PARALLEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setServiceMaxParallel(opt.value)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      serviceMaxParallel === opt.value
                        ? 'border-primary bg-primary/5 text-foreground font-medium'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {nonLinuxCount > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
                <AlertTriangle className="size-3.5 inline mr-1" />
                {nonLinuxCount} non-Linux host{nonLinuxCount !== 1 ? 's' : ''} will be skipped.
                {linuxCount === 0 && ' No Linux hosts in this group.'}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setServiceOpen(false)}>Cancel</Button>
            <Button
              onClick={() => doGroupService()}
              disabled={isServicing || !serviceName.trim() || linuxCount === 0}
            >
              {isServicing && <Loader2 className="size-4 mr-1 animate-spin" />}
              Run Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Hosts Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Hosts to &quot;{group.name}&quot;</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search hosts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border divide-y">
              {filteredSearch.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {allHosts.length === group.members.length
                    ? 'All hosts are already in this group'
                    : 'No hosts match your search'}
                </p>
              ) : (
                filteredSearch.map((host) => (
                  <div
                    key={host.id}
                    className="flex items-center justify-between px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {host.displayName ?? host.hostname}
                      </p>
                      {host.displayName && (
                        <p className="text-xs text-muted-foreground">{host.hostname}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isAdding}
                      onClick={() => doAdd(host.id)}
                    >
                      {isAdding ? <Loader2 className="size-3.5 animate-spin" /> : 'Add'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Patch Group Dialog */}
      <Dialog open={patchOpen} onOpenChange={setPatchOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Patch Group &quot;{group.name}&quot;</DialogTitle>
            <DialogDescription>
              Choose patch settings. The platform will send patch commands to each Linux host in
              this group.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Patch mode */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Patch mode</Label>
              {(
                [
                  { value: 'all', label: 'All updates', desc: 'Full system upgrade' },
                  {
                    value: 'security',
                    label: 'Security updates only',
                    desc: 'Security-flagged packages only',
                  },
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

            {/* Max parallel */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Max parallel hosts</Label>
              <div className="flex flex-wrap gap-2">
                {PARALLEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setMaxParallel(opt.value)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      maxParallel === opt.value
                        ? 'border-primary bg-primary/5 text-foreground font-medium'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Non-Linux warning */}
            {nonLinuxCount > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
                <AlertTriangle className="size-3.5 inline mr-1" />
                {nonLinuxCount} non-Linux host{nonLinuxCount !== 1 ? 's' : ''} in this group will
                be skipped.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPatchOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => doPatchGroup()} disabled={isPatching}>
              {isPatching && <Loader2 className="size-4 mr-1 animate-spin" />}
              Start Patch Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirm */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove &quot;{removeTarget?.displayName ?? removeTarget?.hostname}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the host from the group. The host itself will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeTarget && doRemove(removeTarget.id)}
              disabled={isRemoving}
            >
              {isRemoving && <Loader2 className="size-4 mr-1 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
