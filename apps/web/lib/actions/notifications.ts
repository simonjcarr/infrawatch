'use server'

import { db } from '@/lib/db'
import { notifications } from '@/lib/db/schema'
import { eq, and, desc, count, inArray, gte, sql } from 'drizzle-orm'
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

export async function deleteNotifications(
  orgId: string,
  userId: string,
  ids: string[],
): Promise<{ success: true } | { error: string }> {
  if (ids.length === 0) return { success: true }
  try {
    await db
      .delete(notifications)
      .where(
        and(
          inArray(notifications.id, ids),
          eq(notifications.organisationId, orgId),
          eq(notifications.userId, userId),
        ),
      )
    return { success: true }
  } catch {
    return { error: 'Failed to delete notifications' }
  }
}

export async function markBatchReadStatus(
  orgId: string,
  userId: string,
  ids: string[],
  read: boolean,
): Promise<{ success: true } | { error: string }> {
  if (ids.length === 0) return { success: true }
  try {
    await db
      .update(notifications)
      .set({ read })
      .where(
        and(
          inArray(notifications.id, ids),
          eq(notifications.organisationId, orgId),
          eq(notifications.userId, userId),
        ),
      )
    return { success: true }
  } catch {
    return { error: 'Failed to update notifications' }
  }
}

export type NotificationSeverityStat = {
  severity: string
  total: number
}

export async function getNotificationStats(
  orgId: string,
  userId: string,
): Promise<NotificationSeverityStat[]> {
  const results = await db
    .select({
      severity: notifications.severity,
      total: count(),
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.organisationId, orgId),
        eq(notifications.userId, userId),
      ),
    )
    .groupBy(notifications.severity)
  return results.map((r) => ({ severity: r.severity, total: Number(r.total) }))
}

export type NotificationTimeSeriesPoint = {
  date: string
  critical: number
  warning: number
  info: number
}

export async function getNotificationsOverTime(
  orgId: string,
  userId: string,
  days = 30,
): Promise<NotificationTimeSeriesPoint[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const rows = await db
    .select({
      date: sql<string>`date_trunc('day', ${notifications.createdAt})::date::text`,
      severity: notifications.severity,
      total: count(),
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.organisationId, orgId),
        eq(notifications.userId, userId),
        gte(notifications.createdAt, cutoff),
      ),
    )
    .groupBy(
      sql`date_trunc('day', ${notifications.createdAt})::date`,
      notifications.severity,
    )
    .orderBy(sql`date_trunc('day', ${notifications.createdAt})::date`)

  const map = new Map<string, NotificationTimeSeriesPoint>()
  for (const row of rows) {
    const point = map.get(row.date) ?? { date: row.date, critical: 0, warning: 0, info: 0 }
    if (row.severity === 'critical') point.critical = Number(row.total)
    else if (row.severity === 'warning') point.warning = Number(row.total)
    else if (row.severity === 'info') point.info = Number(row.total)
    map.set(row.date, point)
  }
  return Array.from(map.values())
}
