'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
  Trash2,
  Loader2,
  Layers,
  Zap,
  User,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { HostMetricsLineChart, HostHeartbeatBarChart } from '@/components/charts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getHost, getHostMetrics, getHeartbeatHistory, deleteHost, uninstallAndDeleteHost } from '@/lib/actions/agents'
import type { HostWithAgent, MetricsPreset, MetricsQuery, HeartbeatPoint } from '@/lib/actions/agents'
import { useHostStream } from '@/hooks/use-host-stream'
import { useChartZoom } from '@/hooks/use-chart-zoom'
import type { DiskInfo, NetworkInterface } from '@/lib/db/schema'
import { ChecksTab } from './checks-tab'
import { AlertsTab } from './alerts-tab'
import { HostNotificationCharts } from './host-notification-charts'
import { SettingsTab } from './settings-tab'
import { LocalUsersTab } from './local-users-tab'
import { TasksTab } from './tasks-tab'
import { InventoryTab } from './inventory-tab'
import { HostTerminalLauncher } from './host-terminal-launcher'
import { checkTerminalAccess } from '@/lib/actions/terminal'
import { getAlertInstances } from '@/lib/actions/alerts'
import { getHostCollectionSettings } from '@/lib/actions/host-settings'
import { getServiceAccounts } from '@/lib/actions/service-accounts'
import { listGroupsForHost, listGroups, addHostToGroup, removeHostFromGroup } from '@/lib/actions/host-groups'
import { listNetworksForHost, listNetworks, addHostToNetwork, removeHostFromNetwork } from '@/lib/actions/networks'
import type { HostGroup } from '@/lib/db/schema'
import type { HostGroupWithCount } from '@/lib/actions/host-groups'
import type { NetworkWithMembership, NetworkWithCount } from '@/lib/actions/networks'

type ParentTabId = 'overview' | 'monitoring' | 'infrastructure' | 'inventory' | 'management' | 'tools'
type Tab = 'overview' | 'storage' | 'network' | 'metrics' | 'checks' | 'alerts' | 'users' | 'settings' | 'groups' | 'host-networks' | 'tasks' | 'terminal' | 'packages'

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  storage: 'Storage',
  network: 'Network',
  metrics: 'Metrics',
  checks: 'Checks',
  alerts: 'Alerts',
  users: 'Users',
  settings: 'Settings',
  groups: 'Groups',
  'host-networks': 'Networks',
  tasks: 'Tasks',
  terminal: 'Terminal',
  packages: 'Packages',
}

const PARENT_TABS: Array<{
  id: ParentTabId
  label: string
  defaultTab: Tab
  children: Tab[] | null
}> = [
  { id: 'overview', label: 'Overview', defaultTab: 'overview', children: null },
  { id: 'monitoring', label: 'Monitoring', defaultTab: 'metrics', children: ['metrics', 'checks', 'alerts'] },
  { id: 'infrastructure', label: 'Infrastructure', defaultTab: 'storage', children: ['storage', 'network'] },
  { id: 'inventory', label: 'Inventory', defaultTab: 'packages', children: ['packages'] },
  { id: 'management', label: 'Management', defaultTab: 'groups', children: ['users', 'groups', 'host-networks', 'settings'] },
  { id: 'tools', label: 'Tools', defaultTab: 'tasks', children: ['tasks', 'terminal'] },
]

interface Props {
  host: HostWithAgent
  orgId: string
  currentUserId: string
  userRole: string
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

export function HostDetailClient({ host: initialHost, orgId, currentUserId, userRole, latestAgentVersion }: Props) {
  const [activeParentTab, setActiveParentTab] = useState<ParentTabId>('overview')
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [metricsRange, setMetricsRange] = useState<MetricsPreset>('24h')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [uninstallAgent, setUninstallAgent] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [addNetworkOpen, setAddNetworkOpen] = useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()

  const { zoomedBounds, isZoomed, chartHandlers, chartCursor, selectionRange, resetZoom } = useChartZoom()

  // Either the committed zoom window or the active preset — drives all three metric queries
  const activeQuery: MetricsQuery = zoomedBounds ?? metricsRange

  // Stable timestamp for this render pass — used for domain boundaries and the sentinel point.
  // Defined here (before queries) so xAxisDomain is available when chart props are assembled.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [metricsRange, zoomedBounds])

  // X-axis domain — always explicit so the chart spans the full intended range even when
  // data has gaps or fewer points than expected (e.g. hourly buckets for 7d).
  const presetHours: Record<MetricsPreset, number> = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720 }
  const xAxisDomain: [number, number] = zoomedBounds
    ? [zoomedBounds.from, zoomedBounds.to]
    : [now - presetHours[metricsRange] * 3_600_000, now]

  // Derive visible span hours for tick format and label decisions
  const spanHours = zoomedBounds
    ? (zoomedBounds.to - zoomedBounds.from) / 3_600_000
    : metricsRange === '1h' ? 1
    : metricsRange === '6h' ? 6
    : metricsRange === '24h' ? 24
    : metricsRange === '7d' ? 168
    : 720

  const { mutate: removeHost, isPending: isDeleting } = useMutation({
    mutationFn: (opts: { uninstall: boolean }) =>
      opts.uninstall
        ? uninstallAndDeleteHost(orgId, currentUserId, initialHost.id)
        : deleteHost(orgId, initialHost.id),
    onSuccess: (result) => {
      if ('success' in result) {
        setDeleteError(null)
        // Cancel and remove all queries for this host before navigating away
        // to stop refetchInterval timers from firing against a deleted resource
        queryClient.cancelQueries({ queryKey: ['host', orgId, initialHost.id] })
        queryClient.cancelQueries({ queryKey: ['host-metrics', orgId, initialHost.id] })
        queryClient.cancelQueries({ queryKey: ['host-heartbeat-history', orgId, initialHost.id] })
        queryClient.cancelQueries({ queryKey: ['alerts', orgId, 'firing', initialHost.id] })
        queryClient.cancelQueries({ queryKey: ['host-collection-settings', orgId, initialHost.id] })
        queryClient.cancelQueries({ queryKey: ['local-users-count', orgId, initialHost.id] })
        queryClient.cancelQueries({ queryKey: ['checks-history', orgId, initialHost.id] })
        queryClient.removeQueries({ queryKey: ['host', orgId, initialHost.id] })
        queryClient.removeQueries({ queryKey: ['host-metrics', orgId, initialHost.id] })
        queryClient.removeQueries({ queryKey: ['host-heartbeat-history', orgId, initialHost.id] })
        queryClient.removeQueries({ queryKey: ['alerts', orgId, 'firing', initialHost.id] })
        queryClient.removeQueries({ queryKey: ['host-collection-settings', orgId, initialHost.id] })
        queryClient.removeQueries({ queryKey: ['local-users-count', orgId, initialHost.id] })
        queryClient.removeQueries({ queryKey: ['checks-history', orgId, initialHost.id] })
        // Also invalidate the hosts list so it reflects the deletion
        queryClient.invalidateQueries({ queryKey: ['hosts'] })
        router.push('/hosts')
      } else {
        // Error case — keep dialog open so user can retry or fall back to
        // host-only delete (especially important when the uninstall task
        // failed or timed out).
        setDeleteError(result.error)
      }
    },
  })

  useHostStream({ hostId: initialHost.id, orgId })

  const { data: host } = useQuery({
    queryKey: ['host', orgId, initialHost.id],
    queryFn: () => getHost(orgId, initialHost.id),
    initialData: initialHost,
    refetchInterval: 30_000,
  })

  const { data: metricsData = [], isLoading: metricsLoading } = useQuery({
    queryKey: ['host-metrics', orgId, initialHost.id, activeQuery],
    queryFn: () => getHostMetrics(orgId, initialHost.id, activeQuery),
    enabled: activeTab === 'metrics',
    refetchInterval: isZoomed ? false : 60_000,
  })

  const { data: heartbeatData = [] } = useQuery<HeartbeatPoint[]>({
    queryKey: ['host-heartbeat-history', orgId, initialHost.id, activeQuery],
    queryFn: () => getHeartbeatHistory(orgId, initialHost.id, activeQuery),
    enabled: activeTab === 'metrics',
    refetchInterval: isZoomed ? false : 60_000,
  })

  const { data: activeAlerts = [] } = useQuery({
    queryKey: ['alerts', orgId, 'firing', initialHost.id],
    queryFn: () => getAlertInstances(orgId, { status: 'firing', hostId: initialHost.id }),
    refetchInterval: 30_000,
  })
  const activeAlertCount = activeAlerts.length

  const { data: collectionSettings } = useQuery({
    queryKey: ['host-collection-settings', orgId, initialHost.id],
    queryFn: () => getHostCollectionSettings(orgId, initialHost.id),
  })

  const { data: localUsers = [] } = useQuery({
    queryKey: ['local-users-count', orgId, initialHost.id],
    queryFn: () => getServiceAccounts(orgId, { hostId: initialHost.id, limit: 1 }),
    enabled: collectionSettings?.localUsers === true,
  })
  const localUserCount = localUsers.length > 0 ? localUsers.length : 0

  const { data: hostGroupsList = [] } = useQuery<HostGroup[]>({
    queryKey: ['host-groups-for-host', orgId, initialHost.id],
    queryFn: () => listGroupsForHost(orgId, initialHost.id),
    enabled: activeTab === 'groups',
  })

  const { data: allGroups = [] } = useQuery<HostGroupWithCount[]>({
    queryKey: ['host-groups', orgId],
    queryFn: () => listGroups(orgId),
    enabled: activeTab === 'groups',
  })

  const { data: terminalAccess } = useQuery({
    queryKey: ['terminal-access', orgId, initialHost.id],
    queryFn: () => checkTerminalAccess(orgId, initialHost.id),
    enabled: activeTab === 'terminal',
  })

  const { mutate: doAddToGroup, isPending: isAddingToGroup } = useMutation({
    mutationFn: (groupId: string) => addHostToGroup(orgId, groupId, initialHost.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['host-groups-for-host', orgId, initialHost.id] })
      queryClient.invalidateQueries({ queryKey: ['host-groups', orgId] })
      setAddGroupOpen(false)
    },
  })

  const { mutate: doRemoveFromGroup, isPending: isRemovingFromGroup } = useMutation({
    mutationFn: (groupId: string) => removeHostFromGroup(orgId, groupId, initialHost.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['host-groups-for-host', orgId, initialHost.id] })
      queryClient.invalidateQueries({ queryKey: ['host-groups', orgId] })
    },
  })

  const { data: hostNetworksList = [] } = useQuery<NetworkWithMembership[]>({
    queryKey: ['networks-for-host', orgId, initialHost.id],
    queryFn: () => listNetworksForHost(orgId, initialHost.id),
    enabled: activeTab === 'host-networks',
  })

  const { data: allNetworks = [] } = useQuery<NetworkWithCount[]>({
    queryKey: ['networks', orgId],
    queryFn: () => listNetworks(orgId),
    enabled: activeTab === 'host-networks',
  })

  const { mutate: doAddToNetwork, isPending: isAddingToNetwork } = useMutation({
    mutationFn: (networkId: string) => addHostToNetwork(orgId, networkId, initialHost.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['networks-for-host', orgId, initialHost.id] })
      queryClient.invalidateQueries({ queryKey: ['networks', orgId] })
      setAddNetworkOpen(false)
    },
  })

  const { mutate: doRemoveFromNetwork, isPending: isRemovingFromNetwork } = useMutation({
    mutationFn: (networkId: string) => removeHostFromNetwork(orgId, networkId, initialHost.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['networks-for-host', orgId, initialHost.id] })
      queryClient.invalidateQueries({ queryKey: ['networks', orgId] })
    },
  })

  const tickFormat =
    spanHours <= 2  ? 'HH:mm:ss' :
    spanHours <= 72 ? 'HH:mm'    : 'MMM d HH:mm'

  // Sentinel null point keeps the right edge of the chart at "now" on live preset views.
  // Omit it when zoomed: the sentinel sits at the current time, which falls outside the
  // zoom window and causes Recharts to expand the X-axis domain beyond zoomedBounds.to.
  const chartData = [
    ...metricsData.map((row) => ({
      time: new Date(row.recordedAt).getTime(),
      cpu: row.cpuPercent != null ? parseFloat(row.cpuPercent.toFixed(1)) : null,
      memory: row.memoryPercent != null ? parseFloat(row.memoryPercent.toFixed(1)) : null,
      disk: row.diskPercent != null ? parseFloat(row.diskPercent.toFixed(1)) : null,
    })),
    ...(zoomedBounds ? [] : [{ time: now, cpu: null, memory: null, disk: null }]),
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="size-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold text-foreground">
              {host.displayName ?? host.hostname}
            </h1>
            <StatusBadge status={host.status} />
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setDeleteError(null)
              setUninstallAgent(false)
              setDeleteOpen(true)
            }}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="size-4 mr-1 animate-spin" />
            ) : (
              <Trash2 className="size-4 mr-1" />
            )}
            Delete Host
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Last seen {formatLastSeen(host.lastSeenAt)}
        </p>
      </div>

      {/* Parent tabs */}
      <div className="border-b flex gap-0">
        {PARENT_TABS.map((parent) => (
          <TabButton
            key={parent.id}
            active={activeParentTab === parent.id}
            onClick={() => {
              setActiveParentTab(parent.id)
              setActiveTab(parent.defaultTab)
            }}
          >
            {parent.label}
            {parent.id === 'monitoring' && activeAlertCount > 0 && (
              <span className="ml-1.5 text-xs bg-red-100 text-red-800 rounded-full px-1.5 py-0.5">
                {activeAlertCount}
              </span>
            )}
          </TabButton>
        ))}
      </div>

      {/* Child tabs */}
      {PARENT_TABS.find((p) => p.id === activeParentTab)?.children && (
        <div className="border-b flex gap-0 bg-muted/30 px-2">
          {PARENT_TABS.find((p) => p.id === activeParentTab)!.children!.map((childTab) => {
            if (childTab === 'users' && !collectionSettings?.localUsers) return null
            return (
              <TabButton
                key={childTab}
                active={activeTab === childTab}
                onClick={() => setActiveTab(childTab)}
              >
                {TAB_LABELS[childTab]}
                {childTab === 'storage' && disks.length > 0 && (
                  <span className="ml-1.5 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
                    {disks.length}
                  </span>
                )}
                {childTab === 'network' && networkInterfaces.length > 0 && (
                  <span className="ml-1.5 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
                    {networkInterfaces.length}
                  </span>
                )}
                {childTab === 'alerts' && activeAlertCount > 0 && (
                  <span className="ml-1.5 text-xs bg-red-100 text-red-800 rounded-full px-1.5 py-0.5">
                    {activeAlertCount}
                  </span>
                )}
                {childTab === 'users' && localUserCount > 0 && (
                  <span className="ml-1.5 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
                    {localUserCount}
                  </span>
                )}
              </TabButton>
            )
          })}
        </div>
      )}

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
          <div className="flex items-center gap-2 flex-wrap">
            {(['1h', '6h', '24h', '7d', '30d'] as MetricsPreset[]).map((r) => (
              <button
                key={r}
                onClick={() => { resetZoom(); setMetricsRange(r) }}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  metricsRange === r && !isZoomed
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {r === '1h' ? 'Last hour' : r === '6h' ? 'Last 6h' : r === '24h' ? 'Last 24h' : r === '7d' ? 'Last 7 days' : 'Last 30 days'}
              </button>
            ))}
            {isZoomed && (
              <button
                onClick={resetZoom}
                className="px-3 py-1.5 text-sm rounded-md border transition-colors bg-background text-muted-foreground border-border hover:text-foreground"
              >
                Reset zoom
              </button>
            )}
            {isZoomed && zoomedBounds && (
              <span className="text-xs text-muted-foreground">
                {format(zoomedBounds.from, 'MMM d HH:mm')} → {format(zoomedBounds.to, 'MMM d HH:mm')}
              </span>
            )}
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
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="size-4 text-muted-foreground" />
                    CPU, Memory &amp; Disk Usage (%)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <HostMetricsLineChart
                    data={chartData}
                    xAxisDomain={xAxisDomain}
                    tickFormat={tickFormat}
                    selectionRange={selectionRange}
                    chartHandlers={chartHandlers}
                    chartCursor={chartCursor}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="size-4 text-muted-foreground" />
                    Heartbeat Interval
                    <span className="text-xs font-normal text-muted-foreground">
                      — seconds between consecutive heartbeats
                      {spanHours > 2 && ' (max per bucket)'}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {heartbeatData.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No heartbeat data for this period.
                    </p>
                  ) : (
                    <HostHeartbeatBarChart
                      data={heartbeatData}
                      xAxisDomain={xAxisDomain}
                      tickFormat={tickFormat}
                      selectionRange={selectionRange}
                      chartHandlers={chartHandlers}
                      chartCursor={chartCursor}
                    />
                  )}
                </CardContent>
              </Card>

              <HostNotificationCharts
                orgId={orgId}
                userId={currentUserId}
                hostId={initialHost.id}
              />
            </>
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

      {/* Users Tab */}
      {activeTab === 'users' && collectionSettings?.localUsers && (
        <LocalUsersTab orgId={orgId} hostId={initialHost.id} />
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <SettingsTab orgId={orgId} hostId={initialHost.id} isAdmin={userRole === 'org_admin' || userRole === 'super_admin'} />
      )}

      {/* Groups Tab */}
      {activeTab === 'groups' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Groups this host belongs to.
            </p>
            <Button size="sm" onClick={() => setAddGroupOpen(true)} disabled={allGroups.length === hostGroupsList.length}>
              <Layers className="size-4 mr-1" />
              Add to Group
            </Button>
          </div>
          {hostGroupsList.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <Layers className="size-8 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">Not in any groups</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add this host to a group to target it in batch operations.
              </p>
              <Button className="mt-4" size="sm" onClick={() => setAddGroupOpen(true)}>
                <Layers className="size-4 mr-1" />
                Add to Group
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border divide-y">
              {hostGroupsList.map((group) => (
                <div key={group.id} className="flex items-center gap-3 px-4 py-3">
                  <Layers className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/hosts/groups/${group.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {group.name}
                    </Link>
                    {group.description && (
                      <p className="text-xs text-muted-foreground truncate">{group.description}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive shrink-0"
                    disabled={isRemovingFromGroup}
                    onClick={() => doRemoveFromGroup(group.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add to Group Dialog */}
          <AlertDialog open={addGroupOpen} onOpenChange={setAddGroupOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Add to Group</AlertDialogTitle>
                <AlertDialogDescription>
                  Select a group to add this host to.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="divide-y rounded-lg border max-h-64 overflow-y-auto">
                {allGroups.filter((g) => !hostGroupsList.some((hg) => hg.id === g.id)).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    This host is already in all available groups.
                  </p>
                ) : (
                  allGroups
                    .filter((g) => !hostGroupsList.some((hg) => hg.id === g.id))
                    .map((group) => (
                      <div key={group.id} className="flex items-center justify-between px-3 py-2.5">
                        <div>
                          <p className="text-sm font-medium text-foreground">{group.name}</p>
                          {group.description && (
                            <p className="text-xs text-muted-foreground">{group.description}</p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isAddingToGroup}
                          onClick={() => doAddToGroup(group.id)}
                        >
                          {isAddingToGroup ? <Loader2 className="size-3.5 animate-spin" /> : 'Add'}
                        </Button>
                      </div>
                    ))
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Close</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Host Networks Tab */}
      {activeTab === 'host-networks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Networks this host belongs to.
            </p>
            <Button size="sm" onClick={() => setAddNetworkOpen(true)} disabled={allNetworks.length === hostNetworksList.length}>
              <Network className="size-4 mr-1" />
              Add to Network
            </Button>
          </div>
          {hostNetworksList.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <Network className="size-8 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">Not in any networks</p>
              <p className="text-xs text-muted-foreground mt-1">
                This host will be automatically added to a network when its IP matches a defined CIDR.
              </p>
              <Button className="mt-4" size="sm" onClick={() => setAddNetworkOpen(true)}>
                <Network className="size-4 mr-1" />
                Add to Network
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border divide-y">
              {hostNetworksList.map((network) => (
                <div key={network.id} className="flex items-center gap-3 px-4 py-3">
                  <Network className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/hosts/networks/${network.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {network.name}
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="text-xs font-mono text-muted-foreground">{network.cidr}</code>
                      {network.autoAssigned ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Zap className="size-3" />
                          Auto
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="size-3" />
                          Manual
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive shrink-0"
                    disabled={isRemovingFromNetwork}
                    onClick={() => doRemoveFromNetwork(network.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add to Network Dialog */}
          <AlertDialog open={addNetworkOpen} onOpenChange={setAddNetworkOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Add to Network</AlertDialogTitle>
                <AlertDialogDescription>
                  Select a network to add this host to.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="divide-y rounded-lg border max-h-64 overflow-y-auto">
                {allNetworks.filter((n) => !hostNetworksList.some((hn) => hn.id === n.id)).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    This host is already in all available networks.
                  </p>
                ) : (
                  allNetworks
                    .filter((n) => !hostNetworksList.some((hn) => hn.id === n.id))
                    .map((network) => (
                      <div key={network.id} className="flex items-center justify-between px-3 py-2.5">
                        <div>
                          <p className="text-sm font-medium text-foreground">{network.name}</p>
                          <code className="text-xs font-mono text-muted-foreground">{network.cidr}</code>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isAddingToNetwork}
                          onClick={() => doAddToNetwork(network.id)}
                        >
                          {isAddingToNetwork ? <Loader2 className="size-3.5 animate-spin" /> : 'Add'}
                        </Button>
                      </div>
                    ))
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Close</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
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

      {/* Inventory Tab */}
      {activeTab === 'packages' && (
        <InventoryTab orgId={orgId} hostId={initialHost.id} />
      )}

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <TasksTab orgId={orgId} host={host} userId={currentUserId} />
      )}

      {/* Terminal Tab */}
      {activeTab === 'terminal' && (
        <HostTerminalLauncher
          orgId={orgId}
          host={host}
          directAccess={terminalAccess?.allowed === true ? terminalAccess.directAccess : false}
          accessDeniedReason={
            terminalAccess && !terminalAccess.allowed && 'reason' in terminalAccess
              ? terminalAccess.reason
              : null
          }
        />
      )}

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (isDeleting) return
          setDeleteOpen(open)
          if (!open) {
            setDeleteError(null)
            setUninstallAgent(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete host</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete{' '}
              <strong>{host.displayName ?? host.hostname}</strong>? This will
              remove all associated data including metrics, checks, alerts,
              certificates, users, and SSH keys. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Remote uninstall option */}
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <label
                    className={`flex items-start gap-3 ${
                      host.agent?.status === 'active'
                        ? 'cursor-pointer'
                        : 'cursor-not-allowed opacity-60'
                    }`}
                  >
                    <Checkbox
                      checked={uninstallAgent}
                      onCheckedChange={(v) => setUninstallAgent(v === true)}
                      disabled={isDeleting || host.agent?.status !== 'active'}
                      className="mt-0.5"
                    />
                    <div className="flex-1 text-sm">
                      <div className="font-medium text-foreground">
                        Also uninstall agent from the remote host
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        Sends an uninstall command to the agent. The agent will
                        stop its service, remove the binary, configuration, and
                        data before the host record is deleted.
                      </div>
                      {host.agent?.status !== 'active' && (
                        <div className="mt-1 text-amber-600 dark:text-amber-400">
                          Unavailable — the agent must be connected to receive
                          the uninstall command.
                        </div>
                      )}
                    </div>
                  </label>
                </TooltipTrigger>
                {host.agent?.status !== 'active' && (
                  <TooltipContent side="top" className="max-w-xs">
                    The agent is{' '}
                    {host.agent?.status ?? 'not registered'}. Remote uninstall
                    requires an active connection.
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>

          {deleteError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {deleteError}
              {uninstallAgent && (
                <div className="mt-2 text-xs text-foreground">
                  You can uncheck the option above and try again to delete the
                  host record without uninstalling the agent.
                </div>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={isDeleting}
              onClick={(e) => {
                // Prevent the dialog from closing automatically on click so we
                // can keep it open to show the error on failure.
                e.preventDefault()
                setDeleteError(null)
                removeHost({ uninstall: uninstallAgent })
              }}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 mr-1 animate-spin" />
                  {uninstallAgent ? 'Uninstalling & deleting…' : 'Deleting…'}
                </>
              ) : uninstallAgent ? (
                'Uninstall agent & delete'
              ) : (
                'Delete permanently'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
