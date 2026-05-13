'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { Box, Search, X, ShieldAlert, WifiOff, AlertTriangle, Loader2, Activity, BarChart3, History, Play, Square, RotateCw, EyeOff } from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getHostDockerContainerMetrics,
  getHostDockerContainerLifecycleEvents,
  getHostDockerContainers,
  getHostDockerTopContainers,
  type DockerContainerLifecycleEventType,
  type DockerContainerMetricPoint,
  type DockerContainerMetricsPreset,
  type DockerTopContainerMetric,
  type DockerTopContainerStatistic,
} from '@/lib/actions/docker-containers'
import type { DockerRuntimeStatus, HostDockerStatus } from '@/lib/db/schema/docker'

interface Props {
  scopeId: string
  hostId: string
  dockerStatus?: HostDockerStatus | null
}

type DisplayStatus = DockerRuntimeStatus | 'unknown'

const stateOptions = [
  { value: 'all', label: 'All states' },
  { value: 'running', label: 'Running' },
  { value: 'exited', label: 'Exited' },
  { value: 'created', label: 'Created' },
  { value: 'paused', label: 'Paused' },
  { value: 'restarting', label: 'Restarting' },
  { value: 'removing', label: 'Removing' },
  { value: 'dead', label: 'Dead' },
]

const metricRangeOptions: Array<{ value: DockerContainerMetricsPreset; label: string }> = [
  { value: '1h', label: 'Last hour' },
  { value: '6h', label: 'Last 6h' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
]

const topMetricOptions: Array<{ value: DockerTopContainerMetric; label: string }> = [
  { value: 'cpu', label: 'CPU' },
  { value: 'memory', label: 'Memory' },
  { value: 'network', label: 'Network I/O' },
  { value: 'block', label: 'Block I/O' },
]

const topStatisticOptions: Array<{ value: DockerTopContainerStatistic; label: string }> = [
  { value: 'max', label: 'Max' },
  { value: 'p95', label: 'P95' },
]

const lifecycleEventLabels: Record<DockerContainerLifecycleEventType, string> = {
  started: 'Started',
  stopped: 'Stopped',
  restarted: 'Restarted',
  disappeared: 'Disappeared',
}

const lifecycleEventStyles: Record<DockerContainerLifecycleEventType, string> = {
  started: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  stopped: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300',
  restarted: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  disappeared: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
}

const lifecycleEventIcons: Record<DockerContainerLifecycleEventType, typeof Play> = {
  started: Play,
  stopped: Square,
  restarted: RotateCw,
  disappeared: EyeOff,
}

const unavailableCopy: Record<Exclude<DisplayStatus, 'installed'>, { title: string; body: string; icon: typeof AlertTriangle }> = {
  unknown: {
    title: 'Docker status unknown',
    body: 'No Docker runtime status has been reported for this host yet.',
    icon: AlertTriangle,
  },
  not_installed: {
    title: 'Docker not installed',
    body: 'Docker Engine is not installed or was not found on this host.',
    icon: WifiOff,
  },
  permission_denied: {
    title: 'Permission denied',
    body: 'The agent found Docker but cannot read container inventory.',
    icon: ShieldAlert,
  },
  unreachable: {
    title: 'Docker unreachable',
    body: 'Docker was detected but did not respond to the agent.',
    icon: AlertTriangle,
  },
  error: {
    title: 'Docker status error',
    body: 'The agent hit an unexpected Docker status check error.',
    icon: AlertTriangle,
  },
}

function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return '-'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

function formatAbsolute(date: Date | string | null | undefined): string {
  if (!date) return '-'
  return new Date(date).toLocaleString()
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? '-' : `${value.toFixed(1)}%`
}

function formatNumber(value: number | null | undefined): string {
  return value == null ? '-' : Math.round(value).toLocaleString()
}

function formatBytes(value: number | null | undefined): string {
  if (value == null) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function ContainerStateBadge({ state, present }: { state: string | null; present: boolean }) {
  if (!present) {
    return (
      <Badge className="bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100">
        Not present
      </Badge>
    )
  }
  if (state === 'running') {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
        Running
      </Badge>
    )
  }
  if (state === 'exited' || state === 'dead') {
    return (
      <Badge className="bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100">
        {state === 'dead' ? 'Dead' : 'Exited'}
      </Badge>
    )
  }
  if (state === 'restarting' || state === 'paused') {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
        {state === 'restarting' ? 'Restarting' : 'Paused'}
      </Badge>
    )
  }
  return (
    <Badge className="bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100">
      {state || 'Unknown'}
    </Badge>
  )
}

function LifecycleEventBadge({ eventType }: { eventType: DockerContainerLifecycleEventType }) {
  const Icon = lifecycleEventIcons[eventType]
  return (
    <Badge variant="outline" className={`gap-1 ${lifecycleEventStyles[eventType]}`}>
      <Icon className="size-3" />
      {lifecycleEventLabels[eventType]}
    </Badge>
  )
}

function EmptyState({ title, body, icon: Icon = Box }: { title: string; body: string; icon?: typeof Box }) {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <Icon className="size-8 mx-auto text-muted-foreground mb-3" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{body}</p>
    </div>
  )
}

function latestMax(points: DockerContainerMetricPoint[], key: keyof DockerContainerMetricPoint): number | null {
  let max: number | null = null
  for (const point of points) {
    const value = point[key]
    if (typeof value === 'number') {
      max = max == null ? value : Math.max(max, value)
    }
  }
  return max
}

function MetricSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function formatTopContainerValue(metric: DockerTopContainerMetric, value: number | null | undefined): string {
  if (metric === 'network' || metric === 'block') {
    return formatBytes(value)
  }
  return formatPercent(value)
}

function ContainerMetricChart({
  title,
  data,
  lines,
  yFormatter,
}: {
  title: string
  data: Array<Record<string, number | null>>
  lines: Array<{ key: string; name: string; color: string }>
  yFormatter?: (value: number) => string
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="h-52 text-muted-foreground">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fontSize: 12, fill: 'currentColor' }}
              tickLine={false}
              tickFormatter={(ts: number) => format(new Date(ts), 'HH:mm')}
            />
            <YAxis
              tick={{ fontSize: 12, fill: 'currentColor' }}
              tickLine={false}
              width={48}
              tickFormatter={yFormatter}
            />
            <Tooltip
              formatter={(value, name) => [typeof value === 'number' && yFormatter ? yFormatter(value) : value, name]}
              labelFormatter={(ts) => format(new Date(Number(ts)), 'MMM d HH:mm:ss')}
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
                color: 'hsl(var(--popover-foreground))',
                fontSize: '12px',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
            {lines.map((line) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                name={line.name}
                stroke={line.color}
                dot={false}
                strokeWidth={line.name.includes('max') ? 2 : 1.5}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function ContainersTab({ scopeId, hostId, dockerStatus }: Props) {
  const [search, setSearch] = useState('')
  const [state, setState] = useState('all')
  const [image, setImage] = useState('all')
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null)
  const [metricsRange, setMetricsRange] = useState<DockerContainerMetricsPreset>('1h')
  const [topRange, setTopRange] = useState<DockerContainerMetricsPreset>('1h')
  const [topMetric, setTopMetric] = useState<DockerTopContainerMetric>('cpu')
  const [topStatistic, setTopStatistic] = useState<DockerTopContainerStatistic>('max')
  const status: DisplayStatus = dockerStatus?.status ?? 'unknown'
  const dockerUnavailable = status !== 'installed'

  const { data, isLoading } = useQuery({
    queryKey: ['host-docker-containers', scopeId, hostId, search, state, image],
    queryFn: () => getHostDockerContainers(scopeId, hostId, { search, state, image }),
    enabled: !dockerUnavailable,
  })

  const containers = useMemo(() => data?.containers ?? [], [data?.containers])
  const imageOptions = data?.imageOptions ?? []
  const defaultMetricsContainer = containers.find((container) => container.isPresent && container.state === 'running')
    ?? containers.find((container) => container.isPresent)
    ?? containers[0]
    ?? null
  const selectedContainer = containers.find((container) => container.dockerContainerId === selectedContainerId) ?? defaultMetricsContainer
  const effectiveSelectedContainerId = selectedContainer?.dockerContainerId ?? null
  const { data: metricsData, isLoading: metricsLoading } = useQuery({
    queryKey: ['host-docker-container-metrics', scopeId, hostId, effectiveSelectedContainerId, metricsRange],
    queryFn: () => getHostDockerContainerMetrics(scopeId, hostId, effectiveSelectedContainerId!, { range: metricsRange }),
    enabled: !dockerUnavailable && effectiveSelectedContainerId != null,
  })
  const { data: topContainersData, isLoading: topContainersLoading } = useQuery({
    queryKey: ['host-docker-top-containers', scopeId, hostId, topRange, topMetric, topStatistic],
    queryFn: () => getHostDockerTopContainers(scopeId, hostId, {
      range: topRange,
      metric: topMetric,
      statistic: topStatistic,
    }),
    enabled: !dockerUnavailable,
  })
  const { data: lifecycleData, isLoading: lifecycleLoading } = useQuery({
    queryKey: ['host-docker-container-lifecycle-events', scopeId, hostId],
    queryFn: () => getHostDockerContainerLifecycleEvents(scopeId, hostId),
    enabled: !dockerUnavailable,
  })
  const topContainers = topContainersData?.containers ?? []
  const lifecycleEvents = lifecycleData?.events ?? []
  const metricPoints = useMemo(() => metricsData?.points ?? [], [metricsData?.points])
  const chartData = useMemo(() => metricPoints.map((point) => ({
    time: new Date(point.recordedAt).getTime(),
    cpuAvg: point.cpuAvg,
    cpuMax: point.cpuMax,
    memoryAvg: point.memoryAvg,
    memoryMax: point.memoryMax,
    networkRxAvg: point.networkRxAvg,
    networkRxMax: point.networkRxMax,
    networkTxAvg: point.networkTxAvg,
    networkTxMax: point.networkTxMax,
    blockReadAvg: point.blockReadAvg,
    blockReadMax: point.blockReadMax,
    blockWriteAvg: point.blockWriteAvg,
    blockWriteMax: point.blockWriteMax,
    pidsAvg: point.pidsAvg,
    pidsMax: point.pidsMax,
  })), [metricPoints])
  const hasActiveFilters = search.trim() !== '' || state !== 'all' || image !== 'all'
  const clearFilters = () => {
    setSearch('')
    setState('all')
    setImage('all')
  }

  if (dockerUnavailable) {
    const copy = unavailableCopy[status]
    return (
      <div data-testid="host-containers-tab">
        <EmptyState title={copy.title} body={copy.body} icon={copy.icon} />
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="host-containers-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {isLoading ? 'Loading containers...' : `${containers.length} container${containers.length === 1 ? '' : 's'}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, image or ID"
              className="pl-8"
              data-testid="host-containers-search"
            />
          </div>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger className="w-36" data-testid="host-containers-state-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stateOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={image} onValueChange={setImage}>
            <SelectTrigger className="w-48" data-testid="host-containers-image-filter">
              <SelectValue placeholder="Image" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All images</SelectItem>
              {imageOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
              <X className="size-3.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      <Card data-testid="host-docker-top-containers">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="size-4 text-muted-foreground" />
              Top containers
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={topMetric} onValueChange={(value) => setTopMetric(value as DockerTopContainerMetric)}>
                <SelectTrigger className="w-36" data-testid="host-docker-top-metric-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {topMetricOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={topStatistic} onValueChange={(value) => setTopStatistic(value as DockerTopContainerStatistic)}>
                <SelectTrigger className="w-28" data-testid="host-docker-top-stat-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {topStatisticOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={topRange} onValueChange={(value) => setTopRange(value as DockerContainerMetricsPreset)}>
                <SelectTrigger className="w-36" data-testid="host-docker-top-range-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {metricRangeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {topContainersLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="size-5 mx-auto mb-2 animate-spin" />
              Loading top containers...
            </div>
          ) : topContainers.length === 0 ? (
            <EmptyState title="No ranked containers" body="Rankings will appear after the agent uploads container metrics for this range." icon={BarChart3} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Rank</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">{topStatistic === 'p95' ? 'P95' : 'Max'}</TableHead>
                  <TableHead className="text-right">Samples</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topContainers.map((container, index) => (
                  <TableRow
                    key={container.dockerContainerId}
                    data-testid={`host-docker-top-container-row-${container.dockerContainerId}`}
                    className={container.dockerContainerId === effectiveSelectedContainerId ? 'bg-muted/50' : 'cursor-pointer'}
                    onClick={() => setSelectedContainerId(container.dockerContainerId)}
                  >
                    <TableCell className="text-sm text-muted-foreground">{index + 1}</TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {container.primaryName || container.dockerContainerId.slice(0, 12)}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {container.dockerContainerId.slice(0, 12)}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-sm">
                      {container.image || '-'}
                    </TableCell>
                    <TableCell>
                      <ContainerStateBadge state={container.state} present={container.isPresent} />
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {formatTopContainerValue(topMetric, container.value)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {container.sampleCount.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="host-docker-container-lifecycle">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="size-4 text-muted-foreground" />
            Lifecycle timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lifecycleLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="size-5 mx-auto mb-2 animate-spin" />
              Loading lifecycle events...
            </div>
          ) : lifecycleEvents.length === 0 ? (
            <EmptyState title="No lifecycle events" body="Starts, stops, restarts and disappeared containers will appear after new inventory changes are reported." icon={History} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Restarts</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lifecycleEvents.map((event) => (
                  <TableRow key={event.id} data-testid={`host-docker-lifecycle-event-${event.id}`}>
                    <TableCell>
                      <LifecycleEventBadge eventType={event.eventType} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {event.primaryName || event.dockerContainerId.slice(0, 12)}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {event.dockerContainerId.slice(0, 12)}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-sm">
                      {event.image || '-'}
                    </TableCell>
                    <TableCell>
                      <ContainerStateBadge state={event.state} present={event.eventType !== 'disappeared'} />
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">
                      {event.status || '-'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {event.restartCount ?? '-'}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{formatRelative(event.occurredAt)}</div>
                      <div className="text-xs text-muted-foreground">{formatAbsolute(event.occurredAt)}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Box className="size-4 text-muted-foreground" />
            Container Inventory
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="size-5 mx-auto mb-2 animate-spin" />
              Loading containers...
            </div>
          ) : containers.length === 0 ? (
            hasActiveFilters ? (
              <EmptyState title="No containers match your filters" body="Clear the current filters to see all known Docker containers for this host." />
            ) : (
              <EmptyState title="No containers reported" body="Docker is installed, but no current or recently seen containers have been reported yet." />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Restarts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containers.map((container) => (
                  <TableRow
                    key={container.id}
                    data-testid={`host-docker-container-row-${container.dockerContainerId}`}
                    className={container.dockerContainerId === effectiveSelectedContainerId ? 'bg-muted/50' : 'cursor-pointer'}
                    onClick={() => setSelectedContainerId(container.dockerContainerId)}
                  >
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {container.primaryName || container.namesJson[0] || container.dockerContainerId.slice(0, 12)}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {container.dockerContainerId.slice(0, 12)}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-sm">
                      {container.image || '-'}
                    </TableCell>
                    <TableCell>
                      <ContainerStateBadge state={container.state} present={container.isPresent} />
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">
                      {container.status || '-'}
                    </TableCell>
                    <TableCell className="text-sm">{formatRelative(container.lastSeenAt)}</TableCell>
                    <TableCell className="text-sm">{formatAbsolute(container.startedAtSource)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {container.restartCount ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedContainer && (
        <Card data-testid="host-docker-container-metrics">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="size-4 text-muted-foreground" />
                Container Metrics
                <span className="font-mono text-xs font-normal text-muted-foreground">
                  {selectedContainer.primaryName || selectedContainer.dockerContainerId.slice(0, 12)}
                </span>
              </CardTitle>
              <div className="flex flex-wrap items-center gap-1">
                {metricRangeOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={metricsRange === option.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMetricsRange(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <Loader2 className="size-5 mx-auto mb-2 animate-spin" />
                Loading container metrics...
              </div>
            ) : metricPoints.length === 0 ? (
              <EmptyState title="No metrics reported" body="Metric charts will appear after the agent uploads container samples for this container." icon={Activity} />
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <MetricSummary label="CPU max" value={formatPercent(latestMax(metricPoints, 'cpuMax'))} />
                  <MetricSummary label="Memory max" value={formatPercent(latestMax(metricPoints, 'memoryMax'))} />
                  <MetricSummary label="Network RX max" value={formatBytes(latestMax(metricPoints, 'networkRxMax'))} />
                  <MetricSummary label="Block read max" value={formatBytes(latestMax(metricPoints, 'blockReadMax'))} />
                  <MetricSummary label="PIDs max" value={formatNumber(latestMax(metricPoints, 'pidsMax'))} />
                </div>
                <div className="grid gap-6 xl:grid-cols-2">
                  <ContainerMetricChart
                    title="CPU avg/max"
                    data={chartData}
                    yFormatter={(value) => `${value.toFixed(0)}%`}
                    lines={[
                      { key: 'cpuAvg', name: 'CPU avg', color: 'hsl(221, 83%, 53%)' },
                      { key: 'cpuMax', name: 'CPU max', color: 'hsl(0, 84%, 60%)' },
                    ]}
                  />
                  <ContainerMetricChart
                    title="Memory avg/max"
                    data={chartData}
                    yFormatter={(value) => `${value.toFixed(0)}%`}
                    lines={[
                      { key: 'memoryAvg', name: 'Memory avg', color: 'hsl(142, 71%, 45%)' },
                      { key: 'memoryMax', name: 'Memory max', color: 'hsl(38, 92%, 50%)' },
                    ]}
                  />
                  <ContainerMetricChart
                    title="Network I/O"
                    data={chartData}
                    yFormatter={formatBytes}
                    lines={[
                      { key: 'networkRxAvg', name: 'RX avg', color: 'hsl(221, 83%, 53%)' },
                      { key: 'networkRxMax', name: 'RX max', color: 'hsl(0, 84%, 60%)' },
                      { key: 'networkTxAvg', name: 'TX avg', color: 'hsl(142, 71%, 45%)' },
                      { key: 'networkTxMax', name: 'TX max', color: 'hsl(38, 92%, 50%)' },
                    ]}
                  />
                  <ContainerMetricChart
                    title="Block I/O"
                    data={chartData}
                    yFormatter={formatBytes}
                    lines={[
                      { key: 'blockReadAvg', name: 'Read avg', color: 'hsl(221, 83%, 53%)' },
                      { key: 'blockReadMax', name: 'Read max', color: 'hsl(0, 84%, 60%)' },
                      { key: 'blockWriteAvg', name: 'Write avg', color: 'hsl(142, 71%, 45%)' },
                      { key: 'blockWriteMax', name: 'Write max', color: 'hsl(38, 92%, 50%)' },
                    ]}
                  />
                  <ContainerMetricChart
                    title="PIDs"
                    data={chartData}
                    yFormatter={(value) => Math.round(value).toLocaleString()}
                    lines={[
                      { key: 'pidsAvg', name: 'PIDs avg', color: 'hsl(221, 83%, 53%)' },
                      { key: 'pidsMax', name: 'PIDs max', color: 'hsl(0, 84%, 60%)' },
                    ]}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
