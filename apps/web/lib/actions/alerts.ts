'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { alertRules, alertInstances, notificationChannels, hosts } from '@/lib/db/schema'
import { eq, and, isNull, desc, inArray, sql } from 'drizzle-orm'
import type {
  AlertRule,
  AlertInstance,
  AlertInstanceStatus,
  AlertSeverity,
  AlertRuleConfig,
  NotificationChannel,
  WebhookChannelConfig,
  SmtpChannelConfig,
} from '@/lib/db/schema'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertInstanceWithRule = AlertInstance & {
  ruleName: string
  ruleSeverity: AlertSeverity
  hostname: string
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const checkStatusConfigSchema = z.object({
  checkId: z.string().min(1),
  failureThreshold: z.number().int().min(1).max(10),
})

const metricThresholdConfigSchema = z.object({
  metric: z.enum(['cpu', 'memory', 'disk']),
  operator: z.enum(['gt', 'lt']),
  threshold: z.number().min(0).max(100),
})

const createAlertRuleSchema = z.object({
  hostId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(100),
  conditionType: z.enum(['check_status', 'metric_threshold']),
  config: z.union([checkStatusConfigSchema, metricThresholdConfigSchema]),
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
})

const updateAlertRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  config: z.union([checkStatusConfigSchema, metricThresholdConfigSchema]).optional(),
})

const createNotificationChannelSchema = z.discriminatedUnion('type', [
  z.object({
    name: z.string().min(1).max(100),
    type: z.literal('webhook'),
    config: z.object({
      url: z.string().url(),
      secret: z.string().optional(),
    }),
  }),
  z.object({
    name: z.string().min(1).max(100),
    type: z.literal('smtp'),
    config: z.object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      secure: z.boolean(),
      username: z.string().optional(),
      password: z.string().optional(),
      fromAddress: z.string().email(),
      fromName: z.string().optional(),
      toAddresses: z.array(z.string().email()).min(1),
    }),
  }),
])

// ─── Alert Rules ──────────────────────────────────────────────────────────────

export async function getAlertRules(orgId: string, hostId?: string): Promise<AlertRule[]> {
  return db.query.alertRules.findMany({
    where: and(
      eq(alertRules.organisationId, orgId),
      isNull(alertRules.deletedAt),
      eq(alertRules.isGlobalDefault, false),
      hostId != null ? eq(alertRules.hostId, hostId) : undefined,
    ),
    orderBy: alertRules.createdAt,
  })
}

export async function getGlobalAlertDefaults(orgId: string): Promise<AlertRule[]> {
  return db.query.alertRules.findMany({
    where: and(
      eq(alertRules.organisationId, orgId),
      isNull(alertRules.deletedAt),
      eq(alertRules.isGlobalDefault, true),
    ),
    orderBy: alertRules.createdAt,
  })
}

const createGlobalAlertDefaultSchema = z.object({
  name: z.string().min(1).max(100),
  config: metricThresholdConfigSchema,
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
})

export async function createGlobalAlertDefault(
  orgId: string,
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const parsed = createGlobalAlertDefaultSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  try {
    const [row] = await db
      .insert(alertRules)
      .values({
        organisationId: orgId,
        hostId: null,
        name: data.name,
        conditionType: 'metric_threshold',
        config: data.config as AlertRuleConfig,
        severity: data.severity,
        isGlobalDefault: true,
      })
      .returning({ id: alertRules.id })

    if (!row) return { error: 'Insert failed' }
    return { success: true, id: row.id }
  } catch {
    return { error: 'Failed to create global alert default' }
  }
}

export async function deleteGlobalAlertDefault(
  orgId: string,
  ruleId: string,
): Promise<{ success: true } | { error: string }> {
  const existing = await db.query.alertRules.findFirst({
    where: and(
      eq(alertRules.id, ruleId),
      eq(alertRules.organisationId, orgId),
      eq(alertRules.isGlobalDefault, true),
      isNull(alertRules.deletedAt),
    ),
  })
  if (!existing) return { error: 'Global alert default not found' }

  await db
    .update(alertRules)
    .set({ deletedAt: new Date() })
    .where(and(eq(alertRules.id, ruleId), eq(alertRules.organisationId, orgId)))

  return { success: true }
}

export async function applyGlobalDefaultsToHost(
  orgId: string,
  hostId: string,
): Promise<void> {
  const defaults = await getGlobalAlertDefaults(orgId)
  if (defaults.length === 0) return

  await db.insert(alertRules).values(
    defaults.map((rule) => ({
      organisationId: orgId,
      hostId,
      name: rule.name,
      conditionType: rule.conditionType,
      config: rule.config,
      severity: rule.severity,
      enabled: rule.enabled,
      isGlobalDefault: false,
    })),
  )
}

export async function createAlertRule(
  orgId: string,
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const parsed = createAlertRuleSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  try {
    const [row] = await db
      .insert(alertRules)
      .values({
        organisationId: orgId,
        hostId: data.hostId ?? null,
        name: data.name,
        conditionType: data.conditionType,
        config: data.config as AlertRuleConfig,
        severity: data.severity,
      })
      .returning({ id: alertRules.id })

    if (!row) return { error: 'Insert failed' }
    return { success: true, id: row.id }
  } catch {
    return { error: 'Failed to create alert rule' }
  }
}

export async function updateAlertRule(
  orgId: string,
  ruleId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const parsed = updateAlertRuleSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  const existing = await db.query.alertRules.findFirst({
    where: and(
      eq(alertRules.id, ruleId),
      eq(alertRules.organisationId, orgId),
      isNull(alertRules.deletedAt),
    ),
  })
  if (!existing) return { error: 'Alert rule not found' }

  await db
    .update(alertRules)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(data.severity !== undefined && { severity: data.severity }),
      ...(data.config !== undefined && { config: data.config as AlertRuleConfig }),
      updatedAt: new Date(),
    })
    .where(and(eq(alertRules.id, ruleId), eq(alertRules.organisationId, orgId)))

  return { success: true }
}

export async function deleteAlertRule(
  orgId: string,
  ruleId: string,
): Promise<{ success: true } | { error: string }> {
  const existing = await db.query.alertRules.findFirst({
    where: and(
      eq(alertRules.id, ruleId),
      eq(alertRules.organisationId, orgId),
      isNull(alertRules.deletedAt),
    ),
  })
  if (!existing) return { error: 'Alert rule not found' }

  await db
    .update(alertRules)
    .set({ deletedAt: new Date() })
    .where(and(eq(alertRules.id, ruleId), eq(alertRules.organisationId, orgId)))

  return { success: true }
}

// ─── Alert Instances ──────────────────────────────────────────────────────────

export async function getAlertInstances(
  orgId: string,
  filters: { status?: AlertInstanceStatus; hostId?: string; limit?: number } = {},
): Promise<AlertInstanceWithRule[]> {
  const limit = filters.limit ?? 50

  const rows = await db
    .select({
      id: alertInstances.id,
      ruleId: alertInstances.ruleId,
      hostId: alertInstances.hostId,
      organisationId: alertInstances.organisationId,
      status: alertInstances.status,
      message: alertInstances.message,
      triggeredAt: alertInstances.triggeredAt,
      resolvedAt: alertInstances.resolvedAt,
      acknowledgedAt: alertInstances.acknowledgedAt,
      acknowledgedBy: alertInstances.acknowledgedBy,
      metadata: alertInstances.metadata,
      ruleName: alertRules.name,
      ruleSeverity: alertRules.severity,
      hostname: hosts.hostname,
    })
    .from(alertInstances)
    .innerJoin(alertRules, eq(alertInstances.ruleId, alertRules.id))
    .innerJoin(hosts, eq(alertInstances.hostId, hosts.id))
    .where(
      and(
        eq(alertInstances.organisationId, orgId),
        filters.status != null ? eq(alertInstances.status, filters.status) : undefined,
        filters.hostId != null ? eq(alertInstances.hostId, filters.hostId) : undefined,
      ),
    )
    .orderBy(desc(alertInstances.triggeredAt))
    .limit(limit)

  return rows.map((r) => ({
    ...r,
    ruleName: r.ruleName,
    ruleSeverity: r.ruleSeverity as AlertSeverity,
    hostname: r.hostname,
  }))
}

export async function acknowledgeAlert(
  orgId: string,
  instanceId: string,
  userId: string,
): Promise<{ success: true } | { error: string }> {
  const existing = await db.query.alertInstances.findFirst({
    where: and(
      eq(alertInstances.id, instanceId),
      eq(alertInstances.organisationId, orgId),
      eq(alertInstances.status, 'firing'),
    ),
  })
  if (!existing) return { error: 'Alert not found or not in firing state' }

  await db
    .update(alertInstances)
    .set({
      status: 'acknowledged',
      acknowledgedAt: new Date(),
      acknowledgedBy: userId,
    })
    .where(and(eq(alertInstances.id, instanceId), eq(alertInstances.organisationId, orgId)))

  return { success: true }
}

export async function getActiveAlertCountsForHosts(
  orgId: string,
  hostIds: string[],
): Promise<Record<string, number>> {
  if (hostIds.length === 0) return {}

  const rows = await db
    .select({
      hostId: alertInstances.hostId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(alertInstances)
    .where(
      and(
        eq(alertInstances.organisationId, orgId),
        eq(alertInstances.status, 'firing'),
        inArray(alertInstances.hostId, hostIds),
      ),
    )
    .groupBy(alertInstances.hostId)

  return Object.fromEntries(rows.map((r) => [r.hostId, r.count]))
}

// ─── Notification Channels ────────────────────────────────────────────────────

export type NotificationChannelSafe = Omit<NotificationChannel, 'config' | 'type'> & (
  | { type: 'webhook'; config: { url: string; hasSecret: boolean } }
  | { type: 'smtp'; config: { host: string; port: number; fromAddress: string; toAddresses: string[]; hasPassword: boolean } }
)

export async function getNotificationChannels(orgId: string): Promise<NotificationChannelSafe[]> {
  const rows = await db.query.notificationChannels.findMany({
    where: and(
      eq(notificationChannels.organisationId, orgId),
      isNull(notificationChannels.deletedAt),
    ),
    orderBy: notificationChannels.createdAt,
  })

  return rows.map((ch) => {
    if (ch.type === 'smtp') {
      const cfg = ch.config as SmtpChannelConfig
      return {
        ...ch,
        type: 'smtp' as const,
        config: {
          host: cfg.host,
          port: cfg.port,
          fromAddress: cfg.fromAddress,
          toAddresses: cfg.toAddresses,
          hasPassword: !!(cfg.password),
        },
      }
    }
    const cfg = ch.config as WebhookChannelConfig
    return {
      ...ch,
      type: 'webhook' as const,
      config: {
        url: cfg.url,
        hasSecret: !!(cfg.secret),
      },
    }
  })
}

export async function createNotificationChannel(
  orgId: string,
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const parsed = createNotificationChannelSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  try {
    const [row] = await db
      .insert(notificationChannels)
      .values({
        organisationId: orgId,
        name: data.name,
        type: data.type,
        config: data.config as WebhookChannelConfig | SmtpChannelConfig,
      })
      .returning({ id: notificationChannels.id })

    if (!row) return { error: 'Insert failed' }
    return { success: true, id: row.id }
  } catch {
    return { error: 'Failed to create notification channel' }
  }
}

export async function deleteNotificationChannel(
  orgId: string,
  channelId: string,
): Promise<{ success: true } | { error: string }> {
  const existing = await db.query.notificationChannels.findFirst({
    where: and(
      eq(notificationChannels.id, channelId),
      eq(notificationChannels.organisationId, orgId),
      isNull(notificationChannels.deletedAt),
    ),
  })
  if (!existing) return { error: 'Notification channel not found' }

  await db
    .update(notificationChannels)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(notificationChannels.id, channelId), eq(notificationChannels.organisationId, orgId)),
    )

  return { success: true }
}
