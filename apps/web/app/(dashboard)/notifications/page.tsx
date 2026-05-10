import type { Metadata } from 'next'
import { getNotifications, getUnreadCount } from '@/lib/actions/notifications'
import { NotificationsClient } from './notifications-client'

export const metadata: Metadata = {
  title: 'Notifications',
}

export default async function NotificationsPage() {
  const [initialNotifications, initialUnread] = await Promise.all([
    getNotifications(25),
    getUnreadCount(),
  ])

  return (
    <NotificationsClient
      initialNotifications={initialNotifications}
      initialUnread={initialUnread}
    />
  )
}
