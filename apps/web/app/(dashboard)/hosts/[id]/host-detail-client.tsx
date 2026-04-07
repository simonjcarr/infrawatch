'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import {
  ArrowLeft,
  CheckCircle,
  HardDrive,
  Network,
  Server,
  WifiOff,
  AlertTriangle,
  Clock,
  XCircle,
  Activity,
} from 'lucide-react'
import Link from 'next/link'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getHost, getHostMetrics, getAgentOfflinePeriods } from '@/lib/actions/agents'
import type { HostWithAgent, MetricsRange, OfflinePeriod } from '@/lib/actions/agents'
import { useHostStream } from '@/hooks/use-host-stream'
import type { DiskInfo, NetworkInterface } from '@/lib/db/schema'
import { ChecksTab } from './checks-tab'
import { AlertsTab } from './alerts-tab'
import { getAlertInstances } from '@/lib/actions/alerts'

type Tab = 'overview' | 'storage' | 'network' | 'metrics' | 'checks' | 'alerts'

interface Props {
  host: HostWithAgent
  orgId: string
  currentUserId: string
  latestAgentVersion: string
}

/**
 * Compare two semver-ish version strings ("v1.2.3" or "1.2.3").
 * Returns true if `latest` is strictly newer than `current`.
 */
function isAgentOutdated(current: string | null | undefined, latest: string): boolean {
  if (!current) return false
  const parse = (v: string) =>
    v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const c = parse(current)
  const l = parse(latest)
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const a = c[i] ?? 0
    const b = l[i] ?? 0
    if (b > a) return true
    if (b < a) return false
  }
  return false
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

function formatPercent(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${value.toFixed(1)}%`
}

function formatLastSeen(date: Date | string | null | undefined): string {
  if (!date) return 'Never'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(1)} ${units[i]}`
}

function formatUptime(seconds: number | null | undefined): string {
  if (!seconds) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function MetricCard({ label, value, colorClass }: { label: string; value: string; colorClass: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground mb-1">{label}</p>
        <p className={`text-4xl font-bold tabular-nums ${colorClass}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground'
      }`}
    >
      {children}
    </button>
  )
}

export function HostDetailClient({ host: initialHost, orgId, currentUserId, latestAgentVersion }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [metricsRange, setMetricsRange] = useState<MetricsRange>('24h')

  useHostStream({ hostId: initialHost.id, orgId })

  const { data: host } = useQuery({
    queryKey: ['host', orgId, initialHost.id],
    queryFn: () => getHost(orgId, initialHost.id),
    initialData: initialHost,
    refetchInterval: 30_000,
  })

  const { data: metricsData = [], isLoading: metricsLoading } = useQuery({
    queryKey: ['host-metrics', orgId, initialHost.id, metricsRange],
    queryFn: () => getHostMetrics(orgId, initialHost.id, metricsRange),
    enabled: activeTab === 'metrics',
    refetchInterval: 60_000,
  })

  const { data: offlinePeriods = [] } = useQuery<OfflinePeriod[]>({
    queryKey: ['host-offline-periods', orgId, initialHost.id, metricsRange],
    queryFn: () =>
      initialHost.agentId
        ? getAgentOfflinePeriods(orgId, initialHost.agentId, metricsRange)
        : Promise.resolve([]),
    enabled: activeTab === 'metrics' && !!initialHost.agentId,
    refetchInterval: 60_000,
  })

  const { data: activeAlerts = [] } = useQuery({
    queryKey: ['alerts', orgId, 'firing', initialHost.id],
    queryFn: () => getAlertInstances(orgId, { status: 'firing', hostId: initialHost.id }),
    refetchInterval: 30_000,
  })
  const activeAlertCount = activeAlerts.length

  const tickFormat = metricsRange === '7d' ? 'MMM d HH:mm' : 'HH:mm'

  // Use numeric ms timestamps so we can control the X-axis domain precisely.
  // Zero-boundary points are injected at the start and end of each offline period
  // so the lines visually drop to 0 when the agent goes offline and rise again on
  // reconnect. A sentinel null point at Date.now() keeps the right edge current.
  const offlineBoundaries = offlinePeriods.flatMap((p) => [
    { time: p.start, cpu: 0, memory: 0, disk: 0 },
    ...(p.end != null ? [{ time: p.end, cpu: 0, memory: 0, disk: 0 }] : []),
  ])

  const chartData = [
    ...metricsData.map((row) => ({
      time: new Date(row.recordedAt).getTime(),
      cpu: row.cpuPercent != null ? parseFloat(row.cpuPercent.toFixed(1)) : null,
      memory: row.memoryPercent != null ? parseFloat(row.memoryPercent.toFixed(1)) : null,
      disk: row.diskPercent != null ? parseFloat(row.diskPercent.toFixed(1)) : null,
    })),
    ...offlineBoundaries,
    { time: Date.now(), cpu: null, memory: null, disk: null },
  ].sort((a, b) => a.time - b.time)

  if (!host) return null

  const disks: DiskInfo[] = host.metadata?.disks ?? []
  const networkInterfaces: NetworkInterface[] = host.metadata?.network_interfaces ?? []

  const cpuColor =
    (host.cpuPercent ?? 0) > 90
      ? 'text-red-600'
      : (host.cpuPercent ?? 0) > 70
        ? 'text-amber-600'
        : 'text-foreground'

  const memColor =
    (host.memoryPercent ?? 0) > 90
      ? 'text-red-600'
      : (host.memoryPercent ?? 0) > 70
        ? 'text-amber-600'
        : 'text-foreground'

  const diskColor =
    (host.diskPercent ?? 0) > 90
      ? 'text-red-600'
      : (host.diskPercent ?? 0) > 70
        ? 'text-amber-600'
        : 'text-foreground'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/hosts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="size-4" />
          Back to hosts
        </Link>
        <div className="flex items-center gap-3">
          <Server className="size-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold text-foreground">
            {host.displayName ?? host.hostname}
          </h1>
          <StatusBadge status={host.status} />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Last seen {formatLastSeen(host.lastSeenAt)}
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-0">
        <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
          Overview
        </TabButton>
        <TabButton active={activeTab === 'storage'} onClick={() => setActiveTab('storage')}>
          Storage
          {disks.length > 0 && (
            <span className="ml-1.5 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
              {disks.length}
            </span>
          )}
        </TabButton>
        <TabButton active={activeTab === 'network'} onClick={() => setActiveTab('network')}>
          Network
          {networkInterfaces.length > 0 && (
            <span className="ml-1.5 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
              {networkInterfaces.length}
            </span>
          )}
        </TabButton>
        <TabButton active={activeTab === 'metrics'} onClick={() => setActiveTab('metrics')}>
          Metrics
        </TabButton>
        <TabButton active={activeTab === 'checks'} onClick={() => setActiveTab('checks')}>
          Checks
        </TabButton>
        <TabButton active={activeTab === 'alerts'} onClick={() => setActiveTab('alerts')}>
          Alerts
          {activeAlertCount > 0 && (
            <span className="ml-1.5 text-xs bg-red-100 text-red-800 rounded-full px-1.5 py-0.5">
              {activeAlertCount}
            </span>
          )}
        </TabButton>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Metric gauges */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard label="CPU Usage" value={formatPercent(host.cpuPercent)} colorClass={cpuColor} />
            <MetricCard label="Memory Usage" value={formatPercent(host.memoryPercent)} colorClass={memColor} />
            <MetricCard label="Disk Usage (root)" value={formatPercent(host.diskPercent)} colorClass={diskColor} />
          </div>

          {/* Info cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">System Information</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Hostname</dt>
                    <dd className="font-medium text-foreground">{host.hostname}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Operating System</dt>
                    <dd className="font-medium text-foreground">{host.os ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">OS Version</dt>
                    <dd className="font-medium text-foreground max-w-xs text-right">{host.osVersion ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Architecture</dt>
                    <dd className="font-medium text-foreground">{host.arch ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Uptime</dt>
                    <dd className="font-medium text-foreground">{formatUptime(host.uptimeSeconds)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">IP Addresses</dt>
                    <dd className="font-medium text-foreground text-right">
                      {(host.ipAddresses ?? []).length > 0
                        ? (host.ipAddresses ?? []).join(', ')
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Agent</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>
                      {host.agent ? <StatusBadge status={host.agent.status} /> : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <dt className="text-muted-foreground">Version</dt>
                    <dd className="font-medium text-foreground font-mono text-xs flex items-center gap-2">
                      <span>{host.agent?.version ?? '—'}</span>
                      {isAgentOutdated(host.agent?.version, latestAgentVersion) && (
                        <Badge
                          className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 font-sans"
                          title={`Latest available: ${latestAgentVersion}`}
                        >
                          Update available ({latestAgentVersion})
                        </Badge>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Agent ID</dt>
                    <dd className="font-medium text-foreground font-mono text-xs truncate max-w-xs">
                      {host.agentId ?? '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Last Heartbeat</dt>
                    <dd className="font-medium text-foreground">
                      {formatLastSeen(host.agent?.lastHeartbeatAt)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Registered</dt>
                    <dd className="font-medium text-foreground">
                      {host.createdAt
                        ? formatDistanceToNow(new Date(host.createdAt), { addSuffix: true })
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Storage Tab */}
      {activeTab === 'storage' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="size-4 text-muted-foreground" />
              Storage
            </CardTitle>
          </CardHeader>
          <CardContent>
            {disks.length === 0 ? (
              <div className="text-center py-12">
                <HardDrive className="size-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground font-medium">No disk data yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Disk information will appear after the next heartbeat.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mount Point</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Filesystem</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    <TableHead className="text-right">Free</TableHead>
                    <TableHead className="text-right">Used %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {disks.map((disk) => (
                    <TableRow key={disk.mount_point}>
                      <TableCell className="font-medium font-mono text-sm">{disk.mount_point}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{disk.device}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{disk.fs_type}</TableCell>
                      <TableCell className="text-right text-sm">{formatBytes(disk.total_bytes)}</TableCell>
                      <TableCell className="text-right text-sm">{formatBytes(disk.used_bytes)}</TableCell>
                      <TableCell className="text-right text-sm">{formatBytes(disk.free_bytes)}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            disk.percent_used > 90
                              ? 'text-red-600 font-medium'
                              : disk.percent_used > 70
                                ? 'text-amber-600 font-medium'
                                : 'text-foreground'
                          }
                        >
                          {disk.percent_used.toFixed(1)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Metrics Tab */}
      {activeTab === 'metrics' && (
        <div className="space-y-4">
          {/* Range selector */}
          <div className="flex items-center gap-2">
            {(['1h', '24h', '7d'] as MetricsRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setMetricsRange(r)}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  metricsRange === r
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {r === '1h' ? 'Last hour' : r === '24h' ? 'Last 24 hours' : 'Last 7 days'}
              </button>
            ))}
          </div>

          {metricsLoading ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground text-sm">
                Loading metrics…
              </CardContent>
            </Card>
          ) : chartData.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Activity className="size-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground font-medium">No metric history yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Data will appear once the agent starts sending heartbeats.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="size-4 text-muted-foreground" />
                  CPU, Memory &amp; Disk Usage (%)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="time"
                      type="number"
                      scale="time"
                      domain={['dataMin', () => Date.now()]}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      tickFormatter={(ts: number) => format(new Date(ts), tickFormat)}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      tickFormatter={(v: number) => `${v}%`}
                      width={40}
                    />
                    <Tooltip
                      formatter={(value) => [`${value}%`]}
                      labelFormatter={(ts) => format(new Date(Number(ts)), 'MMM d HH:mm:ss')}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                        color: 'hsl(var(--popover-foreground))',
                        fontSize: '12px',
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                    />
                    {offlinePeriods.map((period, i) => (
                      <ReferenceArea
                        key={i}
                        x1={period.start}
                        x2={period.end ?? Date.now()}
                        fill="hsl(220, 13%, 60%)"
                        fillOpacity={0.15}
                        label={{ value: 'Offline', position: 'insideTop', fontSize: 11, fill: 'hsl(220, 13%, 30%)', fontWeight: 500 }}
                      />
                    ))}
                    <Line
                      type="monotone"
                      dataKey="cpu"
                      name="CPU"
                      stroke="hsl(221, 83%, 53%)"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="memory"
                      name="Memory"
                      stroke="hsl(142, 71%, 45%)"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="disk"
                      name="Disk"
                      stroke="hsl(38, 92%, 50%)"
                      dot={false}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Checks Tab */}
      {activeTab === 'checks' && (
        <ChecksTab orgId={orgId} hostId={initialHost.id} />
      )}

      {/* Alerts Tab */}
      {activeTab === 'alerts' && (
        <AlertsTab orgId={orgId} hostId={initialHost.id} currentUserId={currentUserId} />
      )}

      {/* Network Tab */}
      {activeTab === 'network' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="size-4 text-muted-foreground" />
              Network Interfaces
            </CardTitle>
          </CardHeader>
          <CardContent>
            {networkInterfaces.length === 0 ? (
              <div className="text-center py-12">
                <Network className="size-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground font-medium">No network data yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Network information will appear after the next heartbeat.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Interface</TableHead>
                    <TableHead>MAC Address</TableHead>
                    <TableHead>IP Addresses</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {networkInterfaces.map((iface) => (
                    <TableRow key={iface.name}>
                      <TableCell className="font-medium font-mono text-sm">{iface.name}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {iface.mac_address || '—'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {iface.ip_addresses.length > 0 ? (
                          <div className="space-y-0.5">
                            {iface.ip_addresses.map((ip) => (
                              <div key={ip} className="font-mono text-xs text-foreground">
                                {ip}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {iface.is_up ? (
                          <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
                            <CheckCircle className="size-3 mr-1" />
                            Up
                          </Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100">
                            <WifiOff className="size-3 mr-1" />
                            Down
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
