'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  CheckCircle,
  Clock,
  WifiOff,
  XCircle,
  Server,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Search,
  BellRing,
  Cpu,
  MemoryStick,
  HardDrive,
  TimerOff,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
  listHostsPaginated,
  listPendingAgents,
  listDistinctHostOses,
  getHostInventoryStats,
  approveAgent,
  rejectAgent,
} from '@/lib/actions/agents'
import type {
  HostListResult,
  HostInventoryStats,
  HostSortField,
  HostSortDir,
} from '@/lib/actions/agents'
import type { Agent } from '@/lib/db/schema'
import { HOST_HIGH_USAGE_THRESHOLD, HOST_STALE_MINUTES } from '@/lib/db/schema/hosts'
import { getActiveAlertCountsForHosts } from '@/lib/actions/alerts'

type StatusFilter = 'all' | 'online' | 'offline' | 'unknown'

interface HostsClientProps {
  orgId: string
  currentUserId: string
  currentUserRole: string
  initialHostPage: HostListResult
  initialStats: HostInventoryStats
  initialOsOptions: string[]
  initialPendingAgents: Agent[]
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const
const DEFAULT_PAGE_SIZE = 50

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
    case 'revoked':
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
          <XCircle className="size-3 mr-1" />
          Revoked
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

function formatHeartbeat(date: Date | string | null): string {
  if (!date) return 'Never'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(1)}%`
}

function usageClass(value: number | null): string {
  if (value === null || value === undefined) return 'text-muted-foreground'
  if (value >= HOST_HIGH_USAGE_THRESHOLD) return 'text-red-600 font-medium'
  if (value >= 60) return 'text-amber-600'
  return ''
}

interface StatCardProps {
  label: string
  value: number | string
  hint?: string
  icon?: React.ReactNode
  tone?: 'default' | 'positive' | 'negative' | 'warning'
}

function StatCard({ label, value, hint, icon, tone = 'default' }: StatCardProps) {
  const toneClass =
    tone === 'positive'
      ? 'text-green-700'
      : tone === 'negative'
        ? 'text-red-700'
        : tone === 'warning'
          ? 'text-amber-700'
          : 'text-foreground'
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          {icon && <div className="text-muted-foreground">{icon}</div>}
        </div>
        <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  )
}

interface SortableHeaderProps {
  field: HostSortField
  current: HostSortField
  dir: HostSortDir
  onSort: (field: HostSortField) => void
  children: React.ReactNode
  align?: 'left' | 'right'
}

function SortableHeader({
  field,
  current,
  dir,
  onSort,
  children,
  align = 'left',
}: SortableHeaderProps) {
  const isActive = current === field
  const Icon = isActive ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          isActive ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        <span>{children}</span>
        <Icon className="size-3" />
      </button>
    </TableHead>
  )
}

export function HostsClient({
  orgId,
  currentUserId,
  currentUserRole,
  initialHostPage,
  initialStats,
  initialOsOptions,
  initialPendingAgents,
}: HostsClientProps) {
  const queryClient = useQueryClient()
  const isAdmin = currentUserRole === 'super_admin' || currentUserRole === 'org_admin'

  // ─── Filter / sort / page state ────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [os, setOs] = useState<string>('all')
  const [sortBy, setSortBy] = useState<HostSortField>('hostname')
  const [sortDir, setSortDir] = useState<HostSortDir>('asc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)

  // Debounce the search input so typing into the box does not spam the server.
  // Timer lives in a ref so the setState pair (setSearch + setPage) runs from an
  // event callback path rather than from inside an effect — the lint rule
  // `react-hooks/set-state-in-effect` blocks the effect variant.
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [])

  function handleSearchChange(value: string) {
    setSearchInput(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setSearch(value.trim())
      setPage(0)
    }, 250)
  }

  // Any filter change resets to the first page — done inline in the handler to
  // keep the state transition out of an effect.
  function handleStatusChange(value: StatusFilter) {
    setStatus(value)
    setPage(0)
  }
  function handleOsChange(value: string) {
    setOs(value)
    setPage(0)
  }
  function handlePageSizeChange(value: number) {
    setPageSize(value)
    setPage(0)
  }

  const queryParams = useMemo(
    () => ({
      search: search || undefined,
      status: status !== 'all' ? status : undefined,
      os: os !== 'all' ? os : undefined,
      sortBy,
      sortDir,
      limit: pageSize,
      offset: page * pageSize,
    }),
    [search, status, os, sortBy, sortDir, pageSize, page],
  )

  const filtersAreDefault =
    !search && status === 'all' && os === 'all' && sortBy === 'hostname' && sortDir === 'asc' && page === 0

  const { data: hostsPage = initialHostPage } = useQuery({
    queryKey: ['hosts', 'page', orgId, queryParams],
    queryFn: () => listHostsPaginated(orgId, queryParams),
    initialData: filtersAreDefault && pageSize === DEFAULT_PAGE_SIZE ? initialHostPage : undefined,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })

  const { data: stats = initialStats } = useQuery({
    queryKey: ['hosts', 'stats', orgId],
    queryFn: () => getHostInventoryStats(orgId),
    initialData: initialStats,
    refetchInterval: 30_000,
  })

  const { data: osOptions = initialOsOptions } = useQuery({
    queryKey: ['hosts', 'os-options', orgId],
    queryFn: () => listDistinctHostOses(orgId),
    initialData: initialOsOptions,
    refetchInterval: 60_000,
  })

  const hostRows = hostsPage.hosts
  const { data: alertCounts = {} } = useQuery({
    queryKey: ['alert-counts', orgId, hostRows.map((h) => h.id)],
    queryFn: async () => {
      const ids = hostRows.map((h) => h.id)
      if (ids.length === 0) return {}
      return getActiveAlertCountsForHosts(orgId, ids)
    },
    enabled: hostRows.length > 0,
    refetchInterval: 30_000,
  })

  const { data: pendingAgents = initialPendingAgents } = useQuery({
    queryKey: ['agents', 'pending', orgId],
    queryFn: () => listPendingAgents(orgId),
    initialData: initialPendingAgents,
    refetchInterval: 15_000,
  })

  const approveMutation = useMutation({
    mutationFn: ({ agentId }: { agentId: string }) =>
      approveAgent(orgId, agentId, currentUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', 'pending', orgId] })
      queryClient.invalidateQueries({ queryKey: ['hosts', 'page', orgId] })
      queryClient.invalidateQueries({ queryKey: ['hosts', 'stats', orgId] })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ agentId }: { agentId: string }) =>
      rejectAgent(orgId, agentId, currentUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', 'pending', orgId] })
      queryClient.invalidateQueries({ queryKey: ['hosts', 'stats', orgId] })
    },
  })

  function handleSort(field: HostSortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir(field === 'hostname' || field === 'os' ? 'asc' : 'desc')
    }
    setPage(0)
  }

  function resetFilters() {
    setSearchInput('')
    setSearch('')
    setStatus('all')
    setOs('all')
    setSortBy('hostname')
    setSortDir('asc')
    setPage(0)
  }

  const total = hostsPage.total
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const rangeFrom = total === 0 ? 0 : page * pageSize + 1
  const rangeTo = Math.min((page + 1) * pageSize, total)

  const hasActiveFilters = search !== '' || status !== 'all' || os !== 'all'
  const topOsBreakdown = stats.osBreakdown.slice(0, 4)
  const extraOsCount = stats.osBreakdown.length - topOsBreakdown.length
  const extraOsSum = stats.osBreakdown
    .slice(topOsBreakdown.length)
    .reduce((acc, row) => acc + row.count, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground" data-testid="hosts-heading">Hosts</h1>
        <p className="text-muted-foreground mt-1">
          {stats.total.toLocaleString()} host{stats.total !== 1 ? 's' : ''} registered
        </p>
      </div>

      {/* ─── Summary stats ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Total hosts"
          value={stats.total.toLocaleString()}
          icon={<Server className="size-4" />}
        />
        <StatCard
          label="Online"
          value={stats.online.toLocaleString()}
          tone={stats.online > 0 ? 'positive' : 'default'}
          icon={<CheckCircle className="size-4" />}
          hint={stats.total > 0 ? `${Math.round((stats.online / stats.total) * 100)}% of fleet` : undefined}
        />
        <StatCard
          label="Offline"
          value={stats.offline.toLocaleString()}
          tone={stats.offline > 0 ? 'negative' : 'default'}
          icon={<WifiOff className="size-4" />}
        />
        <StatCard
          label="Firing alerts"
          value={stats.hostsWithFiringAlerts.toLocaleString()}
          tone={stats.hostsWithFiringAlerts > 0 ? 'negative' : 'default'}
          icon={<BellRing className="size-4" />}
          hint={stats.hostsWithFiringAlerts > 0 ? 'hosts with active alerts' : undefined}
        />
        <StatCard
          label={`Stale (> ${HOST_STALE_MINUTES}m)`}
          value={stats.staleHosts.toLocaleString()}
          tone={stats.staleHosts > 0 ? 'warning' : 'default'}
          icon={<TimerOff className="size-4" />}
          hint="no recent heartbeat"
        />
        <StatCard
          label="Pending approval"
          value={stats.pending.toLocaleString()}
          tone={stats.pending > 0 ? 'warning' : 'default'}
          icon={<Clock className="size-4" />}
        />
      </div>

      {/* ─── Resource hotspots + OS breakdown ──────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Resource hotspots</CardTitle>
            <CardDescription>
              Hosts at or above {HOST_HIGH_USAGE_THRESHOLD}% utilisation right now
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex items-center gap-3 p-3 rounded-md border">
                <Cpu className="size-5 text-amber-600" />
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">CPU</div>
                  <div className="text-xl font-semibold">{stats.highCpu}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-md border">
                <MemoryStick className="size-5 text-amber-600" />
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Memory</div>
                  <div className="text-xl font-semibold">{stats.highMemory}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-md border">
                <HardDrive className="size-5 text-amber-600" />
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Disk</div>
                  <div className="text-xl font-semibold">{stats.highDisk}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Operating systems</CardTitle>
            <CardDescription>
              {stats.osBreakdown.length === 0
                ? 'No host data yet'
                : `${stats.osBreakdown.length} distinct OS${stats.osBreakdown.length !== 1 ? "es" : ''} in inventory`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats.osBreakdown.length === 0 ? (
              <div className="text-sm text-muted-foreground">—</div>
            ) : (
              <ul className="space-y-2">
                {topOsBreakdown.map((row) => {
                  const pct = stats.total > 0 ? Math.round((row.count / stats.total) * 100) : 0
                  return (
                    <li key={row.os} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <button
                          type="button"
                          onClick={() => handleOsChange(row.os === 'Unknown' ? 'all' : row.os)}
                          className="text-left hover:underline underline-offset-2"
                          title="Filter list by this OS"
                        >
                          {row.os}
                        </button>
                        <span className="text-muted-foreground tabular-nums">
                          {row.count.toLocaleString()} <span className="text-xs">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
                {extraOsCount > 0 && (
                  <li className="text-xs text-muted-foreground pt-1">
                    + {extraOsCount} other OS{extraOsCount !== 1 ? 'es' : ''} ({extraOsSum.toLocaleString()} hosts)
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {isAdmin && pendingAgents.length > 0 && (
        <Card className="border-amber-200 bg-amber-50" data-testid="pending-agent-approvals">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-amber-900 flex items-center gap-2">
              <Clock className="size-4" />
              Pending Agent Approval ({pendingAgents.length})
            </CardTitle>
            <CardDescription className="text-amber-700">
              These agents are waiting for approval before they can send data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-amber-900">Hostname</TableHead>
                  <TableHead className="text-amber-900">OS</TableHead>
                  <TableHead className="text-amber-900">Registered</TableHead>
                  <TableHead className="text-amber-900">Public Key</TableHead>
                  <TableHead className="text-amber-900 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingAgents.map((agent) => (
                  <TableRow key={agent.id} data-testid={`pending-agent-row-${agent.id}`}>
                    <TableCell className="font-medium text-amber-900">{agent.hostname}</TableCell>
                    <TableCell className="text-amber-800">
                      {agent.os ?? '—'} {agent.arch ? `(${agent.arch})` : ''}
                    </TableCell>
                    <TableCell className="text-amber-800">
                      {formatHeartbeat(agent.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-amber-800 max-w-xs truncate">
                      {agent.publicKey.slice(0, 40)}…
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => approveMutation.mutate({ agentId: agent.id })}
                          disabled={approveMutation.isPending}
                          data-testid={`pending-agent-approve-${agent.id}`}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                          onClick={() => rejectMutation.mutate({ agentId: agent.id })}
                          disabled={rejectMutation.isPending}
                          data-testid={`pending-agent-reject-${agent.id}`}
                        >
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            Host Inventory
          </CardTitle>
          <CardDescription>
            Search, filter and sort across the fleet. Showing paged results from the server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* ─── Filter bar ────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search hostname, display name or IP…"
                className="pl-9"
                data-testid="hosts-search-input"
              />
            </div>
            <Select value={status} onValueChange={(v) => handleStatusChange(v as StatusFilter)}>
              <SelectTrigger className="w-40" data-testid="hosts-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
            <Select value={os} onValueChange={handleOsChange}>
              <SelectTrigger className="w-44" data-testid="hosts-os-filter">
                <SelectValue placeholder="OS" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All operating systems</SelectItem>
                {osOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => handlePageSizeChange(Number(v))}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={String(opt)}>
                    {opt} / page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="gap-1"
                data-testid="hosts-clear-filters"
              >
                <X className="size-3.5" />
                Clear filters
              </Button>
            )}
          </div>

          {/* ─── Table ─────────────────────────────────────────────────────── */}
          {total === 0 ? (
            <div className="text-center py-12">
              <Server className="size-10 mx-auto text-muted-foreground/40 mb-3" />
              {hasActiveFilters ? (
                <>
                  <p className="text-muted-foreground font-medium">No hosts match your filters</p>
                  <Button variant="link" onClick={resetFilters} className="mt-1">
                    Clear filters
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground font-medium">No hosts registered yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Deploy an agent to start monitoring your infrastructure.
                  </p>
                  {isAdmin && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Create an enrolment token in{' '}
                      <a
                        href="/settings/agents"
                        className="text-primary underline underline-offset-2"
                      >
                        Settings → Agents
                      </a>{' '}
                      to get started.
                    </p>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader field="hostname" current={sortBy} dir={sortDir} onSort={handleSort}>
                      Hostname
                    </SortableHeader>
                    <SortableHeader field="os" current={sortBy} dir={sortDir} onSort={handleSort}>
                      OS
                    </SortableHeader>
                    <TableHead>IP Addresses</TableHead>
                    <SortableHeader field="cpuPercent" current={sortBy} dir={sortDir} onSort={handleSort}>
                      CPU
                    </SortableHeader>
                    <SortableHeader field="memoryPercent" current={sortBy} dir={sortDir} onSort={handleSort}>
                      Memory
                    </SortableHeader>
                    <SortableHeader field="diskPercent" current={sortBy} dir={sortDir} onSort={handleSort}>
                      Disk
                    </SortableHeader>
                    <SortableHeader field="lastSeenAt" current={sortBy} dir={sortDir} onSort={handleSort}>
                      Last Seen
                    </SortableHeader>
                    <TableHead>Alerts</TableHead>
                    <SortableHeader field="status" current={sortBy} dir={sortDir} onSort={handleSort}>
                      Status
                    </SortableHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hostRows.map((host) => (
                    <TableRow key={host.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/hosts/${host.id}`}
                          className="hover:underline text-foreground"
                        >
                          {host.displayName ?? host.hostname}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {host.os ?? '—'}
                        {host.arch && (
                          <span className="text-muted-foreground/60"> ({host.arch})</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(host.ipAddresses ?? []).slice(0, 2).join(', ') || '—'}
                      </TableCell>
                      <TableCell className={`text-sm ${usageClass(host.cpuPercent)}`}>
                        {formatPercent(host.cpuPercent)}
                      </TableCell>
                      <TableCell className={`text-sm ${usageClass(host.memoryPercent)}`}>
                        {formatPercent(host.memoryPercent)}
                      </TableCell>
                      <TableCell className={`text-sm ${usageClass(host.diskPercent)}`}>
                        {formatPercent(host.diskPercent)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatHeartbeat(host.lastSeenAt)}
                      </TableCell>
                      <TableCell>
                        {(alertCounts[host.id] ?? 0) > 0 ? (
                          <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
                            {alertCounts[host.id]}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={host.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* ─── Pagination footer ───────────────────────────────────── */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-4">
                <div className="text-sm text-muted-foreground">
                  Showing <span className="tabular-nums font-medium text-foreground">{rangeFrom.toLocaleString()}</span>–
                  <span className="tabular-nums font-medium text-foreground">{rangeTo.toLocaleString()}</span>{' '}
                  of <span className="tabular-nums font-medium text-foreground">{total.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(0)}
                    disabled={page === 0}
                  >
                    First
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground px-2 tabular-nums">
                    Page {page + 1} of {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={page + 1 >= pageCount}
                  >
                    Next
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(pageCount - 1)}
                    disabled={page + 1 >= pageCount}
                  >
                    Last
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
