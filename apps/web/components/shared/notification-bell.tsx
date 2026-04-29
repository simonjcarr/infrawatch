'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead } from '@/lib/actions/notifications'
import type { Notification } from '@/lib/db/schema'

interface NotificationBellProps {
  orgId: string
  userId: string
}

function getResourceUrl(resourceType: string, resourceId: string): string {
  switch (resourceType) {
    case 'host': return `/hosts/${resourceId}`
    case 'certificate': return `/certificates/${resourceId}`
    default: return '/alerts'
  }
}

function severityDot(severity: string) {
  const cls = severity === 'critical'
    ? 'bg-red-500'
    : severity === 'warning'
    ? 'bg-amber-500'
    : 'bg-blue-500'
  return <span className={`inline-block size-2 rounded-full shrink-0 mt-1.5 ${cls}`} />
}

export function NotificationBell({ orgId, userId }: NotificationBellProps) {
  const qc = useQueryClient()

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications-unread', orgId, userId],
    queryFn: () => getUnreadCount(orgId, userId),
    refetchInterval: 20_000,
    staleTime: 10_000,
  })

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications-recent', orgId, userId],
    queryFn: () => getNotifications(orgId, userId, 10),
    refetchInterval: 20_000,
    staleTime: 10_000,
  })

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markAsRead(orgId, userId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-unread', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-recent', orgId, userId] })
    },
  })

  const markAllMutation = useMutation({
    mutationFn: () => markAllAsRead(orgId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-unread', orgId, userId] })
      qc.invalidateQueries({ queryKey: ['notifications-recent', orgId, userId] })
    },
  })

  function navigateTo(path: string) {
    window.location.assign(path)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="notification-bell-trigger">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none"
              data-testid="notification-bell-unread-count"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <DropdownMenuLabel className="flex items-center justify-between py-2">
          <span className="font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
              data-testid="notification-bell-mark-all-read"
              onClick={(e) => {
                e.preventDefault()
                markAllMutation.mutate()
              }}
            >
              Mark all read
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {notifications.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="flex items-start gap-2.5 p-3 cursor-pointer"
                data-testid={`notification-bell-item-${n.id}`}
                onSelect={(event) => {
                  event.preventDefault()
                  markReadMutation.mutate(n.id)
                  navigateTo(getResourceUrl(n.resourceType, n.resourceId))
                }}
              >
                  {severityDot(n.severity)}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug truncate ${n.read ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>
                      {n.subject}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  {!n.read && (
                    <span className="size-1.5 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                  )}
              </DropdownMenuItem>
            ))}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="justify-center text-sm text-muted-foreground hover:text-foreground cursor-pointer py-2"
          data-testid="notification-bell-view-all"
          onSelect={(event) => {
            event.preventDefault()
            navigateTo('/notifications')
          }}
        >
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
