'use server'

import { requireInstanceAccess } from '@/lib/actions/action-auth'
import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope, resolveOptionalActionScope } from './action-scope'

import { db } from '@/lib/db'
import { notifications } from '@/lib/db/schema'
import { eq, and, desc, count, inArray, gte, sql, isNull } from 'drizzle-orm'
import type { Notification } from '@/lib/db/schema'

export async function getNotifications(
  limit = 20,
  offset = 0,
): Promise<Notification[]> {
  const authSession = await getRequiredSession()
  const instanceId = resolveOptionalActionScope(authSession)
  if (!instanceId) return []
  const session = await requireInstanceAccess(instanceId)
  return db.query.notifications.findMany({
    where: and(
      eq(notifications.instanceId, instanceId),
      eq(notifications.userId, session.user.id),
      isNull(notifications.deletedAt),
    ),
    orderBy: desc(notifications.createdAt),
    limit,
    offset,
  })
}

export async function getUnreadCount(): Promise<number> {
  const authSession = await getRequiredSession()
  const instanceId = resolveOptionalActionScope(authSession)
  if (!instanceId) return 0
  const session = await requireInstanceAccess(instanceId)
  const [result] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.instanceId, instanceId),
        eq(notifications.userId, session.user.id),
        eq(notifications.read, false),
        isNull(notifications.deletedAt),
      ),
    )
  return result?.value ?? 0
}

export async function markAsRead(
  notificationId: string,
): Promise<{ success: true } | { error: string }> {
  const authSession = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(authSession)
  const session = await requireInstanceAccess(instanceId)
  try {
    await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.instanceId, instanceId),
          eq(notifications.userId, session.user.id),
          isNull(notifications.deletedAt),
        ),
      )
    return { success: true }
  } catch {
    return { error: 'Failed to mark notification as read' }
  }
}

export async function markAllAsRead(): Promise<{ success: true } | { error: string }> {
  const authSession = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(authSession)
  const session = await requireInstanceAccess(instanceId)
  try {
    await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.instanceId, instanceId),
          eq(notifications.userId, session.user.id),
          eq(notifications.read, false),
          isNull(notifications.deletedAt),
        ),
      )
    return { success: true }
  } catch {
    return { error: 'Failed to mark all notifications as read' }
  }
}

export async function deleteNotification(
  notificationId: string,
): Promise<{ success: true } | { error: string }> {
  const authSession = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(authSession)
  const session = await requireInstanceAccess(instanceId)
  try {
    await db
      .update(notifications)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.instanceId, instanceId),
          eq(notifications.userId, session.user.id),
          isNull(notifications.deletedAt),
        ),
      )
    return { success: true }
  } catch {
    return { error: 'Failed to delete notification' }
  }
}

export async function deleteNotifications(
  ids: string[],
): Promise<{ success: true } | { error: string }> {
  const authSession = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(authSession)
  const session = await requireInstanceAccess(instanceId)
  if (ids.length === 0) return { success: true }
  try {
    await db
      .update(notifications)
      .set({ deletedAt: new Date() })
      .where(
        and(
          inArray(notifications.id, ids),
          eq(notifications.instanceId, instanceId),
          eq(notifications.userId, session.user.id),
          isNull(notifications.deletedAt),
        ),
      )
    return { success: true }
  } catch {
    return { error: 'Failed to delete notifications' }
  }
}

export async function markBatchReadStatus(
  ids: string[],
  read: boolean,
): Promise<{ success: true } | { error: string }> {
  const authSession = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(authSession)
  const session = await requireInstanceAccess(instanceId)
  if (ids.length === 0) return { success: true }
  try {
    await db
      .update(notifications)
      .set({ read })
      .where(
        and(
          inArray(notifications.id, ids),
          eq(notifications.instanceId, instanceId),
          eq(notifications.userId, session.user.id),
          isNull(notifications.deletedAt),
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
  hostId?: string,
): Promise<NotificationSeverityStat[]> {
  const authSession = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(authSession)
  const session = await requireInstanceAccess(instanceId)
  const results = await db
    .select({
      severity: notifications.severity,
      total: count(),
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.instanceId, instanceId),
        eq(notifications.userId, session.user.id),
        isNull(notifications.deletedAt),
        hostId ? eq(notifications.resourceType, 'host') : undefined,
        hostId ? eq(notifications.resourceId, hostId) : undefined,
      ),
    )
    .groupBy(notifications.severity)
  return results.map((r) => ({ severity: r.severity, total: Number(r.total) }))
}

export type TrendRange = '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | '90d'

const TREND_RANGE_CONFIG: Record<TrendRange, { cutoffMs: number; trunc: 'hour' | 'day' }> = {
  '1h':  { cutoffMs: 1  * 60 * 60 * 1000,          trunc: 'hour' },
  '6h':  { cutoffMs: 6  * 60 * 60 * 1000,          trunc: 'hour' },
  '12h': { cutoffMs: 12 * 60 * 60 * 1000,          trunc: 'hour' },
  '24h': { cutoffMs: 24 * 60 * 60 * 1000,          trunc: 'hour' },
  '7d':  { cutoffMs: 7  * 24 * 60 * 60 * 1000,     trunc: 'day'  },
  '30d': { cutoffMs: 30 * 24 * 60 * 60 * 1000,     trunc: 'day'  },
  '90d': { cutoffMs: 90 * 24 * 60 * 60 * 1000,     trunc: 'day'  },
}

export type NotificationTimeSeriesPoint = {
  date: string  // ISO timestamp (hourly) or ISO date string (daily)
  critical: number
  warning: number
  info: number
}

export async function getNotificationsOverTime(
  range: TrendRange = '30d',
  hostId?: string,
): Promise<NotificationTimeSeriesPoint[]> {
  const authSession = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(authSession)
  const session = await requireInstanceAccess(instanceId)
  // Intentionally does NOT filter on deletedAt so that deleting notifications
  // from the inbox does not affect the historical trend.
  const config = TREND_RANGE_CONFIG[range]
  const cutoff = new Date(Date.now() - config.cutoffMs)

  const truncExpr = config.trunc === 'hour'
    ? sql<string>`date_trunc('hour', ${notifications.createdAt})::text`
    : sql<string>`date_trunc('day', ${notifications.createdAt})::date::text`

  const truncGroup = config.trunc === 'hour'
    ? sql`date_trunc('hour', ${notifications.createdAt})`
    : sql`date_trunc('day', ${notifications.createdAt})::date`

  const rows = await db
    .select({
      date: truncExpr,
      severity: notifications.severity,
      total: count(),
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.instanceId, instanceId),
        eq(notifications.userId, session.user.id),
        gte(notifications.createdAt, cutoff),
        hostId ? eq(notifications.resourceType, 'host') : undefined,
        hostId ? eq(notifications.resourceId, hostId) : undefined,
      ),
    )
    .groupBy(truncGroup, notifications.severity)
    .orderBy(truncGroup)

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
