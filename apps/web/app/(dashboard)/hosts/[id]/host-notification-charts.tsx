'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getNotificationStats,
  getNotificationsOverTime,
} from '@/lib/actions/notifications'
import type { TrendRange } from '@/lib/actions/notifications'

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  warning:  '#f59e0b',
  info:     '#3b82f6',
}

const TREND_RANGE_OPTIONS: { value: TrendRange; label: string }[] = [
  { value: '1h',  label: 'Last 1 hour'   },
  { value: '6h',  label: 'Last 6 hours'  },
  { value: '12h', label: 'Last 12 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d',  label: 'Last 7 days'   },
  { value: '30d', label: 'Last 30 days'  },
  { value: '90d', label: 'Last 3 months' },
]

function formatTrendDate(raw: string, range: TrendRange): string {
  const d = new Date(raw)
  if (range === '1h' || range === '6h' || range === '12h' || range === '24h') {
    return format(d, 'HH:mm')
  }
  return format(d, 'MMM d')
}

interface HostNotificationChartsProps {
  orgId: string
  hostId: string
}

export function HostNotificationCharts({ orgId, hostId }: HostNotificationChartsProps) {
  const [trendRange, setTrendRange] = useState<TrendRange>('30d')

  const { data: stats } = useQuery({
    queryKey: ['notifications-stats', orgId, hostId],
    queryFn: () => getNotificationStats(orgId, hostId),
    refetchInterval: 60_000,
  })

  const { data: timeSeries } = useQuery({
    queryKey: ['notifications-time-series', orgId, hostId, trendRange],
    queryFn: () => getNotificationsOverTime(orgId, trendRange, hostId),
    refetchInterval: 60_000,
  })

  const pieData = (stats ?? []).map((s) => ({
    name: s.severity.charAt(0).toUpperCase() + s.severity.slice(1),
    value: s.total,
    fill: SEVERITY_COLORS[s.severity] ?? '#94a3b8',
  }))

  const totalPie = pieData.reduce((sum, d) => sum + d.value, 0)

  const lineData = (timeSeries ?? []).map((point) => ({
    ...point,
    date: formatTrendDate(point.date, trendRange),
  }))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Severity breakdown pie chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Notification Severity</CardTitle>
          <CardDescription className="text-xs">
            All notifications for this host by severity
          </CardDescription>
        </CardHeader>
        <CardContent>
          {totalPie === 0 ? (
            <div className="h-48 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No notifications for this host</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  dataKey="value"
                  nameKey="name"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => {
                    const n = typeof value === 'number' ? value : 0
                    return [`${n} (${Math.round((n / totalPie) * 100)}%)`, String(name)]
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Trend line chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium">Notification Trend</CardTitle>
            <Select value={trendRange} onValueChange={(v) => setTrendRange(v as TrendRange)}>
              <SelectTrigger className="h-7 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TREND_RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CardDescription className="text-xs">
            Critical &amp; warning notifications for this host —{' '}
            {TREND_RANGE_OPTIONS.find((o) => o.value === trendRange)?.label.toLowerCase()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lineData.length === 0 ? (
            <div className="h-48 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No data for this period</p>
            </div>
          ) : (
            <div className="text-muted-foreground">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={lineData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: 'currentColor' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'currentColor' }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="critical"
                    name="Critical"
                    stroke={SEVERITY_COLORS.critical}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="warning"
                    name="Warning"
                    stroke={SEVERITY_COLORS.warning}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
