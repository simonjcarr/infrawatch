'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Server,
  Database,
  Tag,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react'

interface HealthData {
  version: string
  licenceTier: string
  metricRetentionDays: number
  database: { connected: boolean }
  agents: {
    online: number
    offline: number
    total: number
    upgrades: { requiredVersion: string; notUpgraded: number; unknownVersion: number }
    errors: Array<{
      agentId: string | null
      hostname: string
      source: string
      message: string
      occurredAt: string
    }>
  }
  ingest: {
    totalServers: number
    onlineServers: number
    messagesProcessing: number
    messagesReceivedLastHour: number
    heapAllocBytes: number
    heapSysBytes: number
    goroutines: number
    dbOpenConnections: number
    servers: Array<{
      serverId: string
      hostname: string
      processId: number
      version: string | null
      startedAt: string
      observedAt: string
      activeRequests: number
      messagesReceivedTotal: number
      queueDepth: number
      queueCapacity: number
      goroutines: number
      heapAllocBytes: number
      heapSysBytes: number
      dbOpenConnections: number
      dbAcquiredConnections: number
    }>
  }
}

function tierBadgeVariant(tier: string): 'outline' | 'default' | 'secondary' {
  if (tier === 'enterprise') return 'default'
  if (tier === 'pro') return 'secondary'
  return 'outline'
}

function formatTier(tier: string) {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

function StatRow({ label, value, className }: { label: string; value: number | string; className?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium tabular-nums ${className ?? 'text-foreground'}`}>{value}</span>
    </div>
  )
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function SystemHealthClient() {
  const { data, isLoading, error } = useQuery<HealthData>({
    queryKey: ['system-health'],
    queryFn: () => fetch('/api/system/health').then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading system health…</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-destructive py-8">
        <XCircle className="size-4" />
        <span className="text-sm">Failed to load system health data.</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">System Health</h1>
        <p className="text-sm text-muted-foreground mt-1">Platform status and configuration</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Platform */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="size-4 text-muted-foreground" />
              Platform
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatRow label="Version" value={`v${data.version}`} />
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-muted-foreground">Licence tier</span>
              <Badge variant={tierBadgeVariant(data.licenceTier)}>
                {formatTier(data.licenceTier)}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Database */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="size-4 text-muted-foreground" />
              Database
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="text-sm text-muted-foreground">Connection</span>
              {data.database.connected ? (
                <span className="flex items-center gap-1 text-sm font-medium text-green-700">
                  <CheckCircle2 className="size-4" />
                  Connected
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm font-medium text-destructive">
                  <XCircle className="size-4" />
                  Disconnected
                </span>
              )}
            </div>
            <StatRow label="Metric retention" value={`${data.metricRetentionDays} days`} />
          </CardContent>
        </Card>

        {/* Agents */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="size-4 text-muted-foreground" />
              Agent Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatRow label="Total enrolled" value={data.agents.total} />
            <StatRow
              label="Online"
              value={data.agents.online}
              className={data.agents.online > 0 ? 'text-green-700' : 'text-foreground'}
            />
            <StatRow
              label="Offline"
              value={data.agents.offline}
              className={data.agents.offline > 0 ? 'text-amber-600' : 'text-foreground'}
            />
            <StatRow
              label="Not upgraded"
              value={data.agents.upgrades.notUpgraded}
              className={data.agents.upgrades.notUpgraded > 0 ? 'text-amber-600' : 'text-foreground'}
            />
            <StatRow label="Required version" value={data.agents.upgrades.requiredVersion} />
          </CardContent>
        </Card>

        {/* Ingest */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="size-4 text-muted-foreground" />
              Ingest Servers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatRow label="Online" value={`${data.ingest.onlineServers}/${data.ingest.totalServers}`} />
            <StatRow label="Processing now" value={data.ingest.messagesProcessing} />
            <StatRow label="Received last hour" value={data.ingest.messagesReceivedLastHour} />
            <StatRow label="Heap allocated" value={formatBytes(data.ingest.heapAllocBytes)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            Ingest Server Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.ingest.servers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">No ingest status snapshots have been received yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Server</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead className="text-right">Processing</TableHead>
                    <TableHead className="text-right">Queue</TableHead>
                    <TableHead className="text-right">Received total</TableHead>
                    <TableHead className="text-right">Heap</TableHead>
                    <TableHead className="text-right">DB conns</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.ingest.servers.map((server) => (
                    <TableRow key={server.serverId}>
                      <TableCell>
                        <div className="font-medium">{server.hostname}</div>
                        <div className="text-xs text-muted-foreground font-mono">pid {server.processId}</div>
                      </TableCell>
                      <TableCell>{formatDateTime(server.observedAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">{server.activeRequests}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {server.queueDepth}/{server.queueCapacity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{server.messagesReceivedTotal}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBytes(server.heapAllocBytes)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {server.dbAcquiredConnections}/{server.dbOpenConnections}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <XCircle className="size-4 text-muted-foreground" />
            Agent Errors
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.agents.errors.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">No current agent errors found.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.agents.errors.map((error) => (
                    <TableRow key={`${error.source}-${error.agentId ?? error.hostname}-${error.occurredAt}`}>
                      <TableCell>
                        <div className="font-medium">{error.hostname}</div>
                        {error.agentId ? (
                          <div className="text-xs text-muted-foreground font-mono">{error.agentId}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{error.source}</TableCell>
                      <TableCell className="max-w-xl whitespace-normal text-sm">{error.message}</TableCell>
                      <TableCell>{formatDateTime(error.occurredAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
