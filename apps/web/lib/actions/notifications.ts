'use server'

import { db } from '@/lib/db'
import { notifications } from '@/lib/db/schema'
import { eq, and, desc, count } from 'drizzle-orm'
import type { Notification } from '@/lib/db/schema'

export async function getNotifications(
  orgId: string,
  userId: string,
  limit = 20,
  offset = 0,
): Promise<Notification[]> {
  return db.query.notifications.findMany({
    where: and(
      eq(notifications.organisationId, orgId),
      eq(notifications.userId, userId),
    ),
    orderBy: desc(notifications.createdAt),
    limit,
    offset,
  })
}

export async function getUnreadCount(orgId: string, userId: string): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.organisationId, orgId),
        eq(notifications.userId, userId),
        eq(notifications.read, false),
      ),
    )
  return result?.value ?? 0
}

export async function markAsRead(
  orgId: string,
  userId: string,
  notificationId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.organisationId, orgId),
          eq(notifications.userId, userId),
        ),
      )
    return { success: true }
  } catch {
    return { error: 'Failed to mark notification as read' }
  }
}

export async function markAllAsRead(
  orgId: string,
  userId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.organisationId, orgId),
          eq(notifications.userId, userId),
          eq(notifications.read, false),
        ),
      )
    return { success: true }
  } catch {
    return { error: 'Failed to mark all notifications as read' }
  }
}

export async function deleteNotification(
  orgId: string,
  userId: string,
  notificationId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.organisationId, orgId),
          eq(notifications.userId, userId),
        ),
      )
    return { success: true }
  } catch {
    return { error: 'Failed to delete notification' }
  }
}
