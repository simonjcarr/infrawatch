'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow, format } from 'date-fns'
import { Bell, CheckCircle2, ExternalLink, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification } from '@/lib/actions/notifications'
import type { Notification } from '@/lib/db/schema'

const PAGE_SIZE = 25

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

  function handleNotificationClick(n: Notification) {
    if (!n.read) markReadMutation.mutate(n.id)
    setExpandedId(expandedId === n.id ? null : n.id)
  }

  const displayed = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications

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

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            filter === 'all'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            filter === 'unread'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setFilter('unread')}
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
          {displayed.map((n) => (
            <Card
              key={n.id}
              className={`transition-colors ${!n.read ? 'border-blue-200 bg-blue-50/30' : ''}`}
            >
              <CardHeader
                className="py-3 px-4 cursor-pointer"
                onClick={() => handleNotificationClick(n)}
              >
                <div className="flex items-start gap-3">
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
                      {!n.read && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => markReadMutation.mutate(n.id)}
                          disabled={markReadMutation.isPending}
                        >
                          <CheckCircle2 className="size-3.5 mr-1.5" />
                          Mark as read
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
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
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
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
