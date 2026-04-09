'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
  agents: { online: number; offline: number; total: number }
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
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">System Health</h1>
        <p className="text-sm text-muted-foreground mt-1">Platform status and configuration</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
