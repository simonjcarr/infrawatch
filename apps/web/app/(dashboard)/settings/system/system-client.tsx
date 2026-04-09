'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Server,
  ShieldCheck,
  Bell,
  Database,
  Tag,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react'

interface HealthData {
  version: string
  licenceTier: string
  metricRetentionDays: number
  database: { connected: boolean }
  agents: { online: number; offline: number; total: number }
  certificates: { valid: number; expiringSoon: number; expired: number }
  alerts: { active: number; acknowledged: number }
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
        <p className="text-sm text-muted-foreground mt-1">Overview of platform status and resource counts</p>
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
              Agents
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

        {/* Certificates */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" />
              <Link href="/certificates" className="hover:underline">
                Certificates
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatRow
              label="Valid"
              value={data.certificates.valid}
              className={data.certificates.valid > 0 ? 'text-green-700' : 'text-foreground'}
            />
            <StatRow
              label="Expiring soon"
              value={data.certificates.expiringSoon}
              className={data.certificates.expiringSoon > 0 ? 'text-amber-600' : 'text-foreground'}
            />
            <StatRow
              label="Expired"
              value={data.certificates.expired}
              className={data.certificates.expired > 0 ? 'text-destructive' : 'text-foreground'}
            />
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="size-4 text-muted-foreground" />
              <Link href="/alerts" className="hover:underline">
                Active Alerts
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatRow
              label="Firing"
              value={data.alerts.active}
              className={data.alerts.active > 0 ? 'text-destructive' : 'text-foreground'}
            />
            <StatRow
              label="Acknowledged"
              value={data.alerts.acknowledged}
              className={data.alerts.acknowledged > 0 ? 'text-amber-600' : 'text-foreground'}
            />
          </CardContent>
        </Card>

        {/* Status summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="size-4 text-muted-foreground" />
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.alerts.active === 0 && data.certificates.expired === 0 && data.agents.offline === 0 ? (
              <div className="flex items-center gap-2 text-green-700 py-1">
                <CheckCircle2 className="size-4" />
                <span className="text-sm font-medium">All systems nominal</span>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {data.alerts.active > 0 && (
                  <li className="flex items-center gap-2 text-destructive text-sm">
                    <XCircle className="size-4 shrink-0" />
                    {data.alerts.active} alert{data.alerts.active !== 1 ? 's' : ''} firing
                  </li>
                )}
                {data.certificates.expired > 0 && (
                  <li className="flex items-center gap-2 text-destructive text-sm">
                    <XCircle className="size-4 shrink-0" />
                    {data.certificates.expired} certificate{data.certificates.expired !== 1 ? 's' : ''} expired
                  </li>
                )}
                {data.agents.offline > 0 && (
                  <li className="flex items-center gap-2 text-amber-600 text-sm">
                    <AlertTriangle className="size-4 shrink-0" />
                    {data.agents.offline} agent{data.agents.offline !== 1 ? 's' : ''} offline
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
