'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Server,
  ShieldCheck,
  Bell,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react'

interface OverviewData {
  agents: { online: number; offline: number; total: number }
  certificates: { valid: number; expiringSoon: number; expired: number }
  alerts: { firing: number; acknowledged: number }
}

function StatRow({
  label,
  value,
  className,
  testId,
}: {
  label: string
  value: number | string
  className?: string
  testId?: string
}) {
  return (
    <div
      className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
      data-testid={testId}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium tabular-nums ${className ?? 'text-foreground'}`}>
        {value}
      </span>
    </div>
  )
}

export function DashboardClient() {
  const { data, isLoading, error } = useQuery<OverviewData>({
    queryKey: ['overview'],
    queryFn: () => fetch('/api/overview').then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading overview…</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-destructive py-8">
        <XCircle className="size-4" />
        <span className="text-sm">Failed to load overview data.</span>
      </div>
    )
  }

  const hasIssues =
    data.alerts.firing > 0 || data.certificates.expired > 0 || data.agents.offline > 0

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground" data-testid="dashboard-heading">Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Current state of your infrastructure
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Agents */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="size-4 text-muted-foreground" />
              <Link href="/agents" className="hover:underline">
                Agents
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatRow label="Total enrolled" value={data.agents.total} testId="dashboard-agents-total" />
            <StatRow
              label="Online"
              value={data.agents.online}
              className={data.agents.online > 0 ? 'text-green-700' : 'text-foreground'}
              testId="dashboard-agents-online"
            />
            <StatRow
              label="Offline"
              value={data.agents.offline}
              className={data.agents.offline > 0 ? 'text-amber-600' : 'text-foreground'}
              testId="dashboard-agents-offline"
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
              testId="dashboard-certificates-valid"
            />
            <StatRow
              label="Expiring soon"
              value={data.certificates.expiringSoon}
              className={data.certificates.expiringSoon > 0 ? 'text-amber-600' : 'text-foreground'}
              testId="dashboard-certificates-expiring-soon"
            />
            <StatRow
              label="Expired"
              value={data.certificates.expired}
              className={data.certificates.expired > 0 ? 'text-destructive' : 'text-foreground'}
              testId="dashboard-certificates-expired"
            />
          </CardContent>
        </Card>

        {/* Active Alerts */}
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
              value={data.alerts.firing}
              className={data.alerts.firing > 0 ? 'text-destructive' : 'text-foreground'}
              testId="dashboard-alerts-firing"
            />
            <StatRow
              label="Acknowledged"
              value={data.alerts.acknowledged}
              className={data.alerts.acknowledged > 0 ? 'text-amber-600' : 'text-foreground'}
              testId="dashboard-alerts-acknowledged"
            />
          </CardContent>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="size-4 text-muted-foreground" />
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!hasIssues ? (
              <div className="flex items-center gap-2 text-green-700 py-1" data-testid="dashboard-summary-nominal">
                <CheckCircle2 className="size-4" />
                <span className="text-sm font-medium">All systems nominal</span>
              </div>
            ) : (
              <ul className="space-y-1.5" data-testid="dashboard-summary-issues">
                {data.alerts.firing > 0 && (
                  <li className="flex items-center gap-2 text-destructive text-sm">
                    <XCircle className="size-4 shrink-0" />
                    {data.alerts.firing} alert{data.alerts.firing !== 1 ? 's' : ''} firing
                  </li>
                )}
                {data.certificates.expired > 0 && (
                  <li className="flex items-center gap-2 text-destructive text-sm">
                    <XCircle className="size-4 shrink-0" />
                    {data.certificates.expired} certificate
                    {data.certificates.expired !== 1 ? 's' : ''} expired
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
