'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow, format } from 'date-fns'
import { Bell, CheckCircle2, ExternalLink, Trash2, X } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteNotifications,
  markBatchReadStatus,
  getNotificationStats,
  getNotificationsOverTime,
} from '@/lib/actions/notifications'
import type { TrendRange } from '@/lib/actions/notifications'
import type { Notification } from '@/lib/db/schema'

const TREND_RANGE_OPTIONS: { value: TrendRange; label: string }[] = [
  { value: '1h',  label: 'Last 1 hour'  },
  { value: '6h',  label: 'Last 6 hours' },
  { value: '12h', label: 'Last 12 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d',  label: 'Last 7 days'  },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 3 months' },
]

function formatTrendDate(raw: string, range: TrendRange): string {
  // Hourly ranges: raw is a Postgres timestamp text like "2026-04-13 20:00:00"
  // Daily ranges: raw is a date string like "2026-04-13"
  const d = new Date(raw)
  if (range === '1h' || range === '6h' || range === '12h' || range === '24h') {
    return format(d, 'HH:mm')
  }
  if (range === '7d') return format(d, 'MMM d')
  return format(d, 'MMM d')
}

const PAGE_SIZE = 25

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
}

interface NotificationsClientProps {
  orgId: string
  userId: string
  initialNotifications: Notification[]
  initialUnread: number
}

function getResourceUrl(resourceType: string, resourceId: string): string {
  switch (resourceType) {
    case 'host': return `/hosts/${resourceId}`
    case 'certificate': return `/certificates/${resourceId}`
    default: return '/alerts'
  }
}

function severityBadgeVariant(severity: string): 'destructive' | 'default' | 'secondary' | 'outline' {
  if (severity === 'critical') return 'destructive'
  if (severity === 'warning') return 'default'
  return 'secondary'
}

function SeverityDot({ severity }: { severity: string }) {
  const cls = severity === 'critical'
    ? 'bg-red-500'
    : severity === 'warning'
    ? 'bg-amber-500'
    : 'bg-blue-500'
  return <span className={`inline-block size-2.5 rounded-full shrink-0 mt-1 ${cls}`} />
}

function NotificationCharts({ orgId, userId }: { orgId: string; userId: string }) {
  const [trendRange, setTrendRange] = useState<TrendRange>('30d')

  const { data: stats } = useQuery({
    queryKey: ['notifications-stats', orgId, userId],
    queryFn: () => getNotificationStats(orgId, userId),
    refetchInterval: 60_000,
  })

  const { data: timeSeries } = useQuery({
    queryKey: ['notifications-time-series', orgId, userId, trendRange],
    queryFn: () => getNotificationsOverTime(orgId, userId, trendRange),
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
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Severity Breakdown</CardTitle>
          <CardDescription className="text-xs">
            All notifications by severity
          </CardDescription>
        </CardHeader>
        <CardContent>
          {totalPie === 0 ? (
            <div className="h-48 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No data</p>
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
            Critical &amp; warning notifications —{' '}
            {TREND_RANGE_OPTIONS.find((o) => o.value === trendRange)?.label.toLowerCase()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lineData.length === 0 ? (
            <div className="h-48 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No data</p>
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

export function NotificationsClient({
  orgId,
  userId,
  initialNotifications,
  initialUnread,
}: NotificationsClientProps) {
  const router = useRouter()
  const qc = useQueryClient()
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data: unread = initialUnread } = useQuery({
    queryKey: ['notifications-unread', orgId, userId],
    queryFn: () => getUnreadCount(orgId, userId),
    initialData: initialUnread,
    refetchInterval: 20_000,
  })

  const { data: notifications = initialNotifications } = useQuery({
    queryKey: ['notifications', orgId, userId, offset],
    queryFn: () => getNotifications(orgId, userId, PAGE_SIZE, offset),
    initialData: offset === 0 ? initialNotifications : undefined,
    refetchInterval: 30_000,
  })

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markAsRead(orgId, userId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-unread', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-recent', orgId, userId] })
    },
  })

  const markAllMutation = useMutation({
    mutationFn: () => markAllAsRead(orgId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-unread', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-recent', orgId, userId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNotification(orgId, userId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-unread', orgId, userId] })
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteNotifications(orgId, userId, ids),
    onSuccess: () => {
      setSelectedIds(new Set())
      qc.invalidateQueries({ queryKey: ['notifications', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-unread', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-stats', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-time-series', orgId, userId] })
    },
  })

  const bulkMarkReadMutation = useMutation({
    mutationFn: ({ ids, read }: { ids: string[]; read: boolean }) =>
      markBatchReadStatus(orgId, userId, ids, read),
    onSuccess: () => {
      setSelectedIds(new Set())
      qc.invalidateQueries({ queryKey: ['notifications', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-unread', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-recent', orgId, userId] })
    },
  })

  function handleNotificationClick(n: Notification) {
    if (!n.read) markReadMutation.mutate(n.id)
    setExpandedId(expandedId === n.id ? null : n.id)
  }

  function toggleSelectItem(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const displayed = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications
  const allSelected = displayed.length > 0 && displayed.every((n) => selectedIds.has(n.id))
  const someSelected = displayed.some((n) => selectedIds.has(n.id))
  const selectedCount = displayed.filter((n) => selectedIds.has(n.id)).length
  const selectedInDisplayed = displayed.filter((n) => selectedIds.has(n.id)).map((n) => n.id)
  const bulkPending = bulkDeleteMutation.isPending || bulkMarkReadMutation.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Bell className="size-6" />
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Alert events and system messages
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending}
            >
              <CheckCircle2 className="size-3.5 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      <NotificationCharts orgId={orgId} userId={userId} />

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            filter === 'all'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => { setFilter('all'); setSelectedIds(new Set()) }}
        >
          All
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            filter === 'unread'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => { setFilter('unread'); setSelectedIds(new Set()) }}
        >
          Unread
          {unread > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
              {unread}
            </Badge>
          )}
        </button>
      </div>

      {displayed.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Bell className="size-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Select all + bulk action toolbar */}
          <div className="flex items-center gap-3 px-1 py-1.5">
            <Checkbox
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              onCheckedChange={(checked) => {
                if (checked) {
                  setSelectedIds(new Set(displayed.map((n) => n.id)))
                } else {
                  setSelectedIds(new Set())
                }
              }}
              aria-label="Select all notifications"
            />
            <span className="text-xs text-muted-foreground">
              {selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}
            </span>

            {selectedCount > 0 && (
              <>
                <div className="h-4 w-px bg-border" />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={bulkPending}
                  onClick={() => bulkMarkReadMutation.mutate({ ids: selectedInDisplayed, read: true })}
                >
                  <CheckCircle2 className="size-3 mr-1" />
                  Mark as read
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={bulkPending}
                  onClick={() => bulkMarkReadMutation.mutate({ ids: selectedInDisplayed, read: false })}
                >
                  Mark as unread
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  disabled={bulkPending}
                  onClick={() => bulkDeleteMutation.mutate(selectedInDisplayed)}
                >
                  <Trash2 className="size-3 mr-1" />
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs ml-auto"
                  onClick={() => setSelectedIds(new Set())}
                >
                  <X className="size-3 mr-1" />
                  Clear
                </Button>
              </>
            )}
          </div>

          {displayed.map((n) => (
            <Card
              key={n.id}
              className={`transition-colors ${!n.read ? 'border-blue-200 bg-blue-50/30 dark:border-blue-800 dark:bg-blue-950/20' : ''} ${
                selectedIds.has(n.id) ? 'ring-1 ring-primary' : ''
              }`}
            >
              <CardHeader
                className="py-3 px-4 cursor-pointer"
                onClick={() => handleNotificationClick(n)}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="mt-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedIds.has(n.id)}
                      onCheckedChange={(checked) => toggleSelectItem(n.id, !!checked)}
                      aria-label={`Select notification: ${n.subject}`}
                    />
                  </div>
                  <SeverityDot severity={n.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className={`text-sm leading-snug ${n.read ? 'font-normal text-muted-foreground' : 'font-medium text-foreground'}`}>
                        {n.subject}
                      </CardTitle>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant={severityBadgeVariant(n.severity)} className="text-xs">
                          {n.severity}
                        </Badge>
                        {!n.read && (
                          <span className="size-1.5 rounded-full bg-blue-500" />
                        )}
                      </div>
                    </div>
                    <CardDescription className="text-xs mt-0.5">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      {' · '}
                      {format(new Date(n.createdAt), 'MMM d, yyyy HH:mm')}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              {expandedId === n.id && (
                <CardContent className="pt-0 pb-3 px-4 border-t">
                  <div className="pt-3 space-y-3">
                    <p className="text-sm text-foreground">{n.body}</p>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(getResourceUrl(n.resourceType, n.resourceId))}
                      >
                        <ExternalLink className="size-3.5 mr-1.5" />
                        View {n.resourceType}
                      </Button>
                      {!n.read ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => markReadMutation.mutate(n.id)}
                          disabled={markReadMutation.isPending}
                        >
                          <CheckCircle2 className="size-3.5 mr-1.5" />
                          Mark as read
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => markBatchReadStatus(orgId, userId, [n.id], false).then(() => {
                            qc.invalidateQueries({ queryKey: ['notifications', orgId, userId] })
                            qc.invalidateQueries({ queryKey: ['notifications-unread', orgId, userId] })
                            qc.invalidateQueries({ queryKey: ['notifications-recent', orgId, userId] })
                          })}
                        >
                          Mark as unread
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive ml-auto"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteMutation.mutate(n.id)
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}

          {/* Pagination */}
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setSelectedIds(new Set()) }}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Showing {offset + 1}–{offset + displayed.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={notifications.length < PAGE_SIZE}
              onClick={() => { setOffset(offset + PAGE_SIZE); setSelectedIds(new Set()) }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
