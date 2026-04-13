import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getNotifications, getUnreadCount } from '@/lib/actions/notifications'
import { NotificationsClient } from './notifications-client'

export const metadata: Metadata = {
  title: 'Notifications',
}

export default async function NotificationsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId ?? ''
  const userId = session.user.id

  const [initialNotifications, initialUnread] = await Promise.all([
    getNotifications(orgId, userId, 25),
    getUnreadCount(orgId, userId),
  ])

  return (
    <NotificationsClient
      orgId={orgId}
      userId={userId}
      initialNotifications={initialNotifications}
      initialUnread={initialUnread}
    />
  )
}
