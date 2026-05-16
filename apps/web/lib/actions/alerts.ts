'use server'

import { requireInstanceAccess, requireInstanceAdminAccess, requireInstanceWriteAccess } from '@/lib/actions/action-auth'

import { z } from 'zod'
import { createHmac } from 'crypto'
import { createRateLimiter } from '@/lib/rate-limit'
import { assertPublicHost, assertPublicUrl } from '@/lib/net/ssrf-guard'
import { validateStoredNotificationChannelConfig } from '@/lib/actions/alerts-notification-security'
import { writeAuditEvent } from '@/lib/audit/events'
import { decrypt } from '@/lib/crypto/encrypt'
import { parseInstanceMetadata } from '@/lib/db/schema/instance-settings'
import { sendSmtpMessage } from '@/lib/notifications/smtp-send'

const testNotificationLimiter = createRateLimiter({
  scope: 'alerts:test-notification',
  windowMs: 60_000,
  max: 5,
})
import { db } from '@/lib/db'
import { alertRules, alertInstances, notificationChannels, alertSilences, hosts } from '@/lib/db/schema'
import { eq, and, isNull, isNotNull, desc, inArray, sql, lte, gte, count } from 'drizzle-orm'
import type {
  AlertRule,
  AlertInstance,
  AlertInstanceStatus,
  AlertSeverity,
  AlertRuleConfig,
  NotificationChannel,
  WebhookChannelConfig,
  SmtpChannelConfig,
  SlackChannelConfig,
  TelegramChannelConfig,
  AlertSilence,
} from '@/lib/db/schema'
import { instanceSettings } from '@/lib/db/schema'
import type { SmtpEncryption } from '@/lib/notifications/smtp-settings'
import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope, resolveOptionalActionScope } from './action-scope'

async function resolveCurrentAlertScope(): Promise<string> {
  const session = await getRequiredSession()
  return resolveCurrentActionScope(session)
}

async function resolveOptionalAlertScope(): Promise<string | null> {
  const session = await getRequiredSession()
  return resolveOptionalActionScope(session)
}

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

const certExpiryConfigSchema = z.object({
  scope: z.enum(['all', 'specific']),
  certificateId: z.string().min(1).optional(),
  daysBeforeExpiry: z.number().int().min(1).max(365),
})

const dockerContainerAlertConfigSchema = z.object({
  rule: z.enum([
    'restart_loop',
    'memory_near_limit',
    'sustained_cpu',
    'container_missing',
    'high_network_io',
  ]),
  dockerContainerId: z.string().min(1).max(128).optional(),
  windowMinutes: z.number().int().min(1).max(1440),
  threshold: z.number().min(0).max(1_000_000_000_000),
  sampleThreshold: z.number().int().min(1).max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.rule === 'container_missing' && !value.dockerContainerId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dockerContainerId'],
      message: 'Select a container for missing-container alerts',
    })
  }
  if ((value.rule === 'memory_near_limit' || value.rule === 'sustained_cpu') && value.threshold > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['threshold'],
      message: 'Percentage thresholds cannot exceed 100',
    })
  }
})

const createAlertRuleSchema = z.object({
  hostId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(100),
  conditionType: z.enum(['check_status', 'metric_threshold', 'cert_expiry', 'docker_container']),
  config: z.union([checkStatusConfigSchema, metricThresholdConfigSchema, certExpiryConfigSchema, dockerContainerAlertConfigSchema]),
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
})

const updateAlertRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  config: z.union([checkStatusConfigSchema, metricThresholdConfigSchema, certExpiryConfigSchema, dockerContainerAlertConfigSchema]).optional(),
})

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), { message: 'URL must use HTTPS' })

const createNotificationChannelSchema = z.discriminatedUnion('type', [
  z.object({
    name: z.string().min(1).max(100),
    type: z.literal('webhook'),
    config: z.object({
      url: httpsUrl,
      secret: z.string().optional(),
    }),
  }),
  z.object({
    name: z.string().min(1).max(100),
    type: z.literal('smtp'),
    config: z.object({
      toAddresses: z.array(z.string().email()).min(1),
    }),
  }),
  z.object({
    name: z.string().min(1).max(100),
    type: z.literal('slack'),
    config: z.object({
      webhookUrl: httpsUrl,
    }),
  }),
  z.object({
    name: z.string().min(1).max(100),
    type: z.literal('telegram'),
    config: z.object({
      botToken: z.string().min(1, 'Bot token is required'),
      chatId: z.string().min(1, 'Chat ID is required'),
    }),
  }),
])

// ─── Alert Rules ──────────────────────────────────────────────────────────────

export async function getAlertRules(hostId?: string): Promise<AlertRule[]> {
  const instanceId = await resolveCurrentAlertScope()
  await requireInstanceAccess(instanceId)
  return db.query.alertRules.findMany({
    where: and(
      eq(alertRules.instanceId, instanceId),
      isNull(alertRules.deletedAt),
      eq(alertRules.isGlobalDefault, false),
      hostId != null ? eq(alertRules.hostId, hostId) : undefined,
    ),
    orderBy: alertRules.createdAt,
  })
}

export async function getGlobalAlertDefaults(): Promise<AlertRule[]> {
  const instanceId = await resolveOptionalAlertScope()
  if (!instanceId) return []
  await requireInstanceAccess(instanceId)
  return db.query.alertRules.findMany({
    where: and(
      eq(alertRules.instanceId, instanceId),
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
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  await requireInstanceAdminAccess(instanceId)
  const parsed = createGlobalAlertDefaultSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  try {
    const [row] = await db
      .insert(alertRules)
      .values({
        instanceId: instanceId,
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
  ruleId: string,
): Promise<{ success: true } | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  const session = await requireInstanceAdminAccess(instanceId)
  const existing = await db.query.alertRules.findFirst({
    where: and(
      eq(alertRules.id, ruleId),
      eq(alertRules.instanceId, instanceId),
      eq(alertRules.isGlobalDefault, true),
      isNull(alertRules.deletedAt),
    ),
  })
  if (!existing) return { error: 'Global alert default not found' }

  await db
    .update(alertRules)
    .set({ deletedAt: new Date() })
    .where(and(eq(alertRules.id, ruleId), eq(alertRules.instanceId, instanceId)))

  await writeAuditEvent(db, {
    instanceId: instanceId,
    actorUserId: session.user.id,
    action: 'alert_rule.deleted',
    targetType: 'alert_rule',
    targetId: existing.id,
    summary: `Deleted global alert default ${existing.name}`,
    metadata: {
      hostId: existing.hostId,
      isGlobalDefault: existing.isGlobalDefault,
      name: existing.name,
      conditionType: existing.conditionType,
    },
  })

  return { success: true }
}

type MetricDefaultsReplacementResult = {
  success: true
  deletedCount: number
  createdCount: number
  hostCount: number
}

function cloneMetricDefaultsForHost(
  defaults: AlertRule[],
  instanceId: string,
  hostId: string,
) {
  return defaults.map((rule) => ({
    instanceId: instanceId,
    hostId,
    name: rule.name,
    conditionType: rule.conditionType,
    config: rule.config,
    severity: rule.severity,
    enabled: rule.enabled,
    isGlobalDefault: false,
  }))
}

export async function replaceHostMetricAlertsWithGlobalDefaults(
  hostId: string,
): Promise<MetricDefaultsReplacementResult | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  const session = await requireInstanceAdminAccess(instanceId)
  const parsed = z.string().min(1).safeParse(hostId)
  if (!parsed.success) return { error: 'Invalid host' }

  try {
    return await db.transaction(async (tx) => {
      const now = new Date()
      const [existingHost] = await tx
        .select({ id: hosts.id })
        .from(hosts)
        .where(and(
          eq(hosts.id, parsed.data),
          eq(hosts.instanceId, instanceId),
          isNull(hosts.deletedAt),
        ))
        .for('update')
        .limit(1)

      if (!existingHost) return { error: 'Host not found' }

      const defaults = await tx.query.alertRules.findMany({
        where: and(
          eq(alertRules.instanceId, instanceId),
          isNull(alertRules.deletedAt),
          eq(alertRules.isGlobalDefault, true),
          eq(alertRules.conditionType, 'metric_threshold'),
        ),
        orderBy: alertRules.createdAt,
      })

      const deletedRows = await tx
        .update(alertRules)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(
          eq(alertRules.instanceId, instanceId),
          eq(alertRules.hostId, existingHost.id),
          eq(alertRules.conditionType, 'metric_threshold'),
          eq(alertRules.isGlobalDefault, false),
          isNull(alertRules.deletedAt),
        ))
        .returning({ id: alertRules.id })

      if (defaults.length > 0) {
        await tx.insert(alertRules).values(
          cloneMetricDefaultsForHost(defaults, instanceId, existingHost.id),
        )
      }

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'alert_rule.metric_defaults_replaced',
        targetType: 'host',
        targetId: existingHost.id,
        summary: 'Replaced host metric alert rules from global defaults',
        metadata: {
          hostId: existingHost.id,
          deletedCount: deletedRows.length,
          createdCount: defaults.length,
        },
      })

      return {
        success: true,
        deletedCount: deletedRows.length,
        createdCount: defaults.length,
        hostCount: 1,
      }
    })
  } catch {
    return { error: 'Failed to replace host metric alerts' }
  }
}

export async function replaceAllHostMetricAlertsWithGlobalDefaults(): Promise<
  MetricDefaultsReplacementResult | { error: string }
> {
  const instanceId = await resolveCurrentAlertScope()
  const session = await requireInstanceAdminAccess(instanceId)

  try {
    return await db.transaction(async (tx) => {
      const now = new Date()
      const defaults = await tx.query.alertRules.findMany({
        where: and(
          eq(alertRules.instanceId, instanceId),
          isNull(alertRules.deletedAt),
          eq(alertRules.isGlobalDefault, true),
          eq(alertRules.conditionType, 'metric_threshold'),
        ),
        orderBy: alertRules.createdAt,
      })
      const hostRows = await tx.query.hosts.findMany({
        columns: { id: true },
        where: and(eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)),
        orderBy: hosts.createdAt,
      })

      const deletedRows = await tx
        .update(alertRules)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(
          eq(alertRules.instanceId, instanceId),
          isNotNull(alertRules.hostId),
          eq(alertRules.conditionType, 'metric_threshold'),
          eq(alertRules.isGlobalDefault, false),
          isNull(alertRules.deletedAt),
        ))
        .returning({ id: alertRules.id })

      if (defaults.length > 0 && hostRows.length > 0) {
        await tx.insert(alertRules).values(
          hostRows.flatMap((host) => cloneMetricDefaultsForHost(defaults, instanceId, host.id)),
        )
      }

      const createdCount = defaults.length * hostRows.length

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'alert_rule.metric_defaults_replaced_all_hosts',
        targetType: 'instance',
        targetId: instanceId,
        summary: 'Replaced host metric alert rules from global defaults for all hosts',
        metadata: {
          deletedCount: deletedRows.length,
          createdCount,
          hostCount: hostRows.length,
        },
      })

      return {
        success: true,
        deletedCount: deletedRows.length,
        createdCount,
        hostCount: hostRows.length,
      }
    })
  } catch {
    return { error: 'Failed to replace host metric alerts' }
  }
}

export async function createAlertRule(
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  await requireInstanceWriteAccess(instanceId)
  const parsed = createAlertRuleSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  try {
    const [row] = await db
      .insert(alertRules)
      .values({
        instanceId: instanceId,
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
  ruleId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  await requireInstanceWriteAccess(instanceId)
  const parsed = updateAlertRuleSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  const existing = await db.query.alertRules.findFirst({
    where: and(
      eq(alertRules.id, ruleId),
      eq(alertRules.instanceId, instanceId),
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
    .where(and(eq(alertRules.id, ruleId), eq(alertRules.instanceId, instanceId)))

  return { success: true }
}

export async function deleteAlertRule(
  ruleId: string,
): Promise<{ success: true } | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  const session = await requireInstanceWriteAccess(instanceId)
  const existing = await db.query.alertRules.findFirst({
    where: and(
      eq(alertRules.id, ruleId),
      eq(alertRules.instanceId, instanceId),
      isNull(alertRules.deletedAt),
    ),
  })
  if (!existing) return { error: 'Alert rule not found' }

  await db
    .update(alertRules)
    .set({ deletedAt: new Date() })
    .where(and(eq(alertRules.id, ruleId), eq(alertRules.instanceId, instanceId)))

  await writeAuditEvent(db, {
    instanceId: instanceId,
    actorUserId: session.user.id,
    action: 'alert_rule.deleted',
    targetType: 'alert_rule',
    targetId: existing.id,
    summary: `Deleted alert rule ${existing.name}`,
    metadata: {
      hostId: existing.hostId,
      isGlobalDefault: existing.isGlobalDefault,
      name: existing.name,
      conditionType: existing.conditionType,
    },
  })

  return { success: true }
}

// ─── Alert Instances ──────────────────────────────────────────────────────────

export type AlertHistoryFilters = {
  status?: AlertInstanceStatus
  hostId?: string
  severity?: AlertSeverity
  dateFrom?: Date
  dateTo?: Date
  limit?: number
  offset?: number
}

export async function getAlertInstances(
  filters: AlertHistoryFilters = {},
): Promise<AlertInstanceWithRule[]> {
  const instanceId = await resolveOptionalAlertScope()
  if (!instanceId) return []
  await requireInstanceAccess(instanceId)
  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0

  const rows = await db
    .select({
      id: alertInstances.id,
      ruleId: alertInstances.ruleId,
      hostId: alertInstances.hostId,
      instanceId: alertInstances.instanceId,
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
        eq(alertInstances.instanceId, instanceId),
        filters.status != null ? eq(alertInstances.status, filters.status) : undefined,
        filters.hostId != null ? eq(alertInstances.hostId, filters.hostId) : undefined,
        filters.severity != null ? eq(alertRules.severity, filters.severity) : undefined,
        filters.dateFrom != null ? gte(alertInstances.triggeredAt, filters.dateFrom) : undefined,
        filters.dateTo != null ? lte(alertInstances.triggeredAt, filters.dateTo) : undefined,
      ),
    )
    .orderBy(desc(alertInstances.triggeredAt))
    .limit(limit)
    .offset(offset)

  return rows.map((r) => ({
    ...r,
    ruleName: r.ruleName,
    ruleSeverity: r.ruleSeverity as AlertSeverity,
    hostname: r.hostname,
  }))
}

export async function getAlertInstanceCount(
  filters: Omit<AlertHistoryFilters, 'limit' | 'offset'> = {},
): Promise<number> {
  const instanceId = await resolveCurrentAlertScope()
  await requireInstanceAccess(instanceId)
  const rows = await db
    .select({ total: count() })
    .from(alertInstances)
    .innerJoin(alertRules, eq(alertInstances.ruleId, alertRules.id))
    .where(
      and(
        eq(alertInstances.instanceId, instanceId),
        filters.status != null ? eq(alertInstances.status, filters.status) : undefined,
        filters.hostId != null ? eq(alertInstances.hostId, filters.hostId) : undefined,
        filters.severity != null ? eq(alertRules.severity, filters.severity) : undefined,
        filters.dateFrom != null ? gte(alertInstances.triggeredAt, filters.dateFrom) : undefined,
        filters.dateTo != null ? lte(alertInstances.triggeredAt, filters.dateTo) : undefined,
      ),
    )

  return rows[0]?.total ?? 0
}

export async function acknowledgeAlert(
  instanceId: string,
): Promise<{ success: true } | { error: string }> {
  const currentScope = await resolveCurrentAlertScope()
  const session = await requireInstanceWriteAccess(currentScope)
  const existing = await db.query.alertInstances.findFirst({
    where: and(
      eq(alertInstances.id, instanceId),
      eq(alertInstances.instanceId, currentScope),
      eq(alertInstances.status, 'firing'),
    ),
  })
  if (!existing) return { error: 'Alert not found or not in firing state' }

  await db
    .update(alertInstances)
    .set({
      status: 'acknowledged',
      acknowledgedAt: new Date(),
      acknowledgedBy: session.user.id,
    })
    .where(and(eq(alertInstances.id, instanceId), eq(alertInstances.instanceId, currentScope)))

  return { success: true }
}

export async function getActiveAlertCountsForHosts(
  hostIds: string[],
): Promise<Record<string, number>> {
  const currentScope = await resolveCurrentAlertScope()
  await requireInstanceAccess(currentScope)
  if (hostIds.length === 0) return {}

  const rows = await db
    .select({
      hostId: alertInstances.hostId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(alertInstances)
    .where(
      and(
        eq(alertInstances.instanceId, currentScope),
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
  | {
      type: 'smtp'
      config: {
        toAddresses: string[]
      }
    }
  | { type: 'slack'; config: { hasWebhookUrl: boolean } }
  | { type: 'telegram'; config: { chatId: string; hasBotToken: boolean } }
)

/** Normalise SMTP config rows written before the encryption field was introduced. */
function normaliseSmtpConfig(raw: unknown): SmtpChannelConfig {
  const obj = raw as Record<string, unknown>
  if (obj.encryption !== undefined) return obj as unknown as SmtpChannelConfig
  // Rows written with the old `secure: boolean` field
  const encryption: SmtpEncryption = obj.secure ? 'tls' : 'starttls'
  const rest = { ...obj }
  delete rest.secure
  return { ...rest, encryption } as unknown as SmtpChannelConfig
}

export async function getNotificationChannels(): Promise<NotificationChannelSafe[]> {
  const instanceId = await resolveOptionalAlertScope()
  if (!instanceId) return []
  await requireInstanceAccess(instanceId)
  const rows = await db.query.notificationChannels.findMany({
    where: and(
      eq(notificationChannels.instanceId, instanceId),
      isNull(notificationChannels.deletedAt),
    ),
    orderBy: notificationChannels.createdAt,
  })

  return rows.map((ch) => {
    if (ch.type === 'smtp') {
      const cfg = normaliseSmtpConfig(ch.config)
      return {
        ...ch,
        type: 'smtp' as const,
        config: {
          toAddresses: cfg.toAddresses,
        },
      }
    }
    if (ch.type === 'slack') {
      const cfg = ch.config as SlackChannelConfig
      return {
        ...ch,
        type: 'slack' as const,
        config: { hasWebhookUrl: !!(cfg.webhookUrl) },
      }
    }
    if (ch.type === 'telegram') {
      const cfg = ch.config as TelegramChannelConfig
      return {
        ...ch,
        type: 'telegram' as const,
        config: { chatId: cfg.chatId, hasBotToken: !!(cfg.botToken) },
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
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  const session = await requireInstanceAdminAccess(instanceId)
  const parsed = createNotificationChannelSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  try {
    await validateStoredNotificationChannelConfig(data.type, data.config)

    const [row] = await db
      .insert(notificationChannels)
      .values({
        instanceId: instanceId,
        name: data.name,
        type: data.type,
        config: data.config as WebhookChannelConfig | SmtpChannelConfig | SlackChannelConfig | TelegramChannelConfig,
      })
      .returning({ id: notificationChannels.id })

    if (!row) return { error: 'Insert failed' }
    await writeAuditEvent(db, {
      instanceId: instanceId,
      actorUserId: session.user.id,
      action: 'notification_channel.created',
      targetType: 'notification_channel',
      targetId: row.id,
      summary: `Created ${data.type} notification channel ${data.name}`,
      metadata: {
        name: data.name,
        type: data.type,
      },
    })
    return { success: true, id: row.id }
  } catch {
    return { error: 'Failed to create notification channel' }
  }
}

export async function deleteNotificationChannel(
  channelId: string,
): Promise<{ success: true } | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  const session = await requireInstanceAdminAccess(instanceId)
  const existing = await db.query.notificationChannels.findFirst({
    where: and(
      eq(notificationChannels.id, channelId),
      eq(notificationChannels.instanceId, instanceId),
      isNull(notificationChannels.deletedAt),
    ),
  })
  if (!existing) return { error: 'Notification channel not found' }

  await db
    .update(notificationChannels)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(notificationChannels.id, channelId), eq(notificationChannels.instanceId, instanceId)),
    )

  await writeAuditEvent(db, {
    instanceId: instanceId,
    actorUserId: session.user.id,
    action: 'notification_channel.deleted',
    targetType: 'notification_channel',
    targetId: existing.id,
    summary: `Deleted ${existing.type} notification channel ${existing.name}`,
    metadata: {
      name: existing.name,
      type: existing.type,
    },
  })

  return { success: true }
}

const updateWebhookChannelSchema = z.object({
  name: z.string().min(1).max(100),
  url: httpsUrl,
  secret: z.string().optional(),
})

const updateSmtpChannelSchema = z.object({
  name: z.string().min(1).max(100),
  toAddresses: z.array(z.string().email()).min(1),
})

const updateSlackChannelSchema = z.object({
  name: z.string().min(1).max(100),
  webhookUrl: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    httpsUrl.optional(),
  ),
})

const updateTelegramChannelSchema = z.object({
  name: z.string().min(1).max(100),
  botToken: z.string().optional(),
  chatId: z.string().min(1),
})

export async function updateNotificationChannel(
  channelId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  const session = await requireInstanceAdminAccess(instanceId)
  const existing = await db.query.notificationChannels.findFirst({
    where: and(
      eq(notificationChannels.id, channelId),
      eq(notificationChannels.instanceId, instanceId),
      isNull(notificationChannels.deletedAt),
    ),
  })
  if (!existing) return { error: 'Notification channel not found' }

  try {
    let nextName = existing.name

    if (existing.type === 'webhook') {
      const parsed = updateWebhookChannelSchema.safeParse(input)
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
      const { name, url, secret } = parsed.data
      nextName = name
      const existingConfig = existing.config as WebhookChannelConfig
      const newConfig: WebhookChannelConfig = {
        url,
        secret: secret || existingConfig.secret,
      }
      await validateStoredNotificationChannelConfig(existing.type, newConfig)
      await db
        .update(notificationChannels)
        .set({ name, config: newConfig, updatedAt: new Date() })
        .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.instanceId, instanceId)))
    } else if (existing.type === 'smtp') {
      const parsed = updateSmtpChannelSchema.safeParse(input)
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
      const { name, toAddresses } = parsed.data
      nextName = name
      const newConfig: SmtpChannelConfig = {
        toAddresses,
      }
      await validateStoredNotificationChannelConfig(existing.type, newConfig)
      await db
        .update(notificationChannels)
        .set({ name, config: newConfig, updatedAt: new Date() })
        .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.instanceId, instanceId)))
    } else if (existing.type === 'slack') {
      const parsed = updateSlackChannelSchema.safeParse(input)
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
      const { name, webhookUrl } = parsed.data
      nextName = name
      const existingConfig = existing.config as SlackChannelConfig
      const newConfig: SlackChannelConfig = { webhookUrl: webhookUrl || existingConfig.webhookUrl }
      await validateStoredNotificationChannelConfig(existing.type, newConfig)
      await db
        .update(notificationChannels)
        .set({ name, config: newConfig, updatedAt: new Date() })
        .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.instanceId, instanceId)))
    } else if (existing.type === 'telegram') {
      const parsed = updateTelegramChannelSchema.safeParse(input)
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
      const { name, botToken, chatId } = parsed.data
      nextName = name
      const existingConfig = existing.config as TelegramChannelConfig
      const newConfig: TelegramChannelConfig = {
        botToken: botToken || existingConfig.botToken,
        chatId,
      }
      await validateStoredNotificationChannelConfig(existing.type, newConfig)
      await db
        .update(notificationChannels)
        .set({ name, config: newConfig, updatedAt: new Date() })
        .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.instanceId, instanceId)))
    }

    await writeAuditEvent(db, {
      instanceId: instanceId,
      actorUserId: session.user.id,
      action: 'notification_channel.updated',
      targetType: 'notification_channel',
      targetId: existing.id,
      summary: `Updated ${existing.type} notification channel ${nextName}`,
      metadata: {
        previousName: existing.name,
        nextName,
        type: existing.type,
      },
    })

    return { success: true }
  } catch {
    return { error: 'Failed to update notification channel' }
  }
}

export async function sendTestNotification(
  channelId: string,
): Promise<{ success: true } | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  await requireInstanceAdminAccess(instanceId)
  if (!await testNotificationLimiter.check(instanceId)) {
    return { error: 'Too many requests — please wait before sending another test notification.' }
  }
  const existing = await db.query.notificationChannels.findFirst({
    where: and(
      eq(notificationChannels.id, channelId),
      eq(notificationChannels.instanceId, instanceId),
      isNull(notificationChannels.deletedAt),
    ),
  })
  if (!existing) return { error: 'Notification channel not found' }

  if (existing.type === 'webhook') {
    const cfg = existing.config as WebhookChannelConfig
    await assertPublicUrl(cfg.url)
    const payload = JSON.stringify({
      event: 'alert.test',
      severity: 'info',
      host: 'test-host',
      rule: 'Test Notification',
      message: 'This is a test notification from CT-Ops.',
      timestamp: new Date().toISOString(),
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'CT-Ops/1.0',
    }

    if (cfg.secret) {
      const sig = createHmac('sha256', cfg.secret).update(payload).digest('hex')
      headers['X-CT-Ops-Signature'] = `sha256=${sig}`
    }

    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        return { error: `Webhook returned ${res.status} ${res.statusText}` }
      }
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Request failed' }
    }
  } else if (existing.type === 'smtp') {
    const channelCfg = normaliseSmtpConfig(existing.config)
    const instance = await db.query.instanceSettings.findFirst({
      where: eq(instanceSettings.id, instanceId),
      columns: { metadata: true },
    })
    const relay = parseInstanceMetadata(instance?.metadata).notificationSettings?.smtpRelay
    if (!relay?.enabled) return { error: 'Central SMTP relay is not enabled' }
    await assertPublicHost(relay.host)
    let password = ''
    if (relay.passwordEncrypted) {
      try {
        password = decrypt(relay.passwordEncrypted)
      } catch {
        return { error: 'Stored SMTP password could not be decrypted' }
      }
    }
    try {
      await sendSmtpMessage({
        host: relay.host,
        port: relay.port,
        encryption: relay.encryption,
        username: relay.username,
        password,
        fromAddress: relay.fromAddress,
        fromName: relay.fromName,
      }, {
        to: channelCfg.toAddresses,
        subject: 'CT-Ops Test Notification',
        text: 'This is a test notification from CT-Ops. Your SMTP channel is configured correctly.',
        html: '<p>This is a test notification from <strong>CT-Ops</strong>. Your SMTP channel is configured correctly.</p>',
      })
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to send email' }
    }
  } else if (existing.type === 'slack') {
    const cfg = existing.config as SlackChannelConfig
    await assertPublicUrl(cfg.webhookUrl)
    const payload = JSON.stringify({
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: ':large_blue_circle: [TEST] CT-Ops Test Notification' },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'Your Slack notification channel is configured correctly.' },
        },
      ],
    })
    try {
      const res = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return { error: `Slack returned ${res.status} ${res.statusText}` }
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Request failed' }
    }
  } else if (existing.type === 'telegram') {
    const cfg = existing.config as TelegramChannelConfig
    const apiUrl = `https://api.telegram.org/bot${encodeURIComponent(cfg.botToken)}/sendMessage`
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text: '<b>🔵 TEST</b>\n\nYour Telegram notification channel is configured correctly.',
          parse_mode: 'HTML',
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { error: `Telegram returned ${res.status}: ${body}` }
      }
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Request failed' }
    }
  } else {
    return { error: 'Unsupported channel type' }
  }
}

// ─── Alert Silences ───────────────────────────────────────────────────────────

export type AlertSilenceWithHost = AlertSilence & { hostname: string | null }

const createSilenceSchema = z.object({
  hostId: z.string().min(1).nullable().optional(),
  ruleId: z.string().min(1).nullable().optional(),
  reason: z.string().min(1).max(255),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
}).refine((d) => new Date(d.endsAt) > new Date(d.startsAt), {
  message: 'End time must be after start time',
  path: ['endsAt'],
})

export async function getSilences(): Promise<AlertSilenceWithHost[]> {
  const instanceId = await resolveOptionalAlertScope()
  if (!instanceId) return []
  await requireInstanceAccess(instanceId)
  const rows = await db
    .select({
      id: alertSilences.id,
      instanceId: alertSilences.instanceId,
      hostId: alertSilences.hostId,
      ruleId: alertSilences.ruleId,
      reason: alertSilences.reason,
      startsAt: alertSilences.startsAt,
      endsAt: alertSilences.endsAt,
      createdBy: alertSilences.createdBy,
      createdAt: alertSilences.createdAt,
      updatedAt: alertSilences.updatedAt,
      deletedAt: alertSilences.deletedAt,
      metadata: alertSilences.metadata,
      hostname: hosts.hostname,
    })
    .from(alertSilences)
    .leftJoin(hosts, eq(alertSilences.hostId, hosts.id))
    .where(
      and(
        eq(alertSilences.instanceId, instanceId),
        isNull(alertSilences.deletedAt),
      ),
    )
    .orderBy(desc(alertSilences.startsAt))

  return rows
}

export async function getActiveSilencesForHost(
  hostId: string,
): Promise<AlertSilence[]> {
  const instanceId = await resolveCurrentAlertScope()
  await requireInstanceAccess(instanceId)
  const now = new Date()
  return db.query.alertSilences.findMany({
    where: and(
      eq(alertSilences.instanceId, instanceId),
      isNull(alertSilences.deletedAt),
      lte(alertSilences.startsAt, now),
      gte(alertSilences.endsAt, now),
      // match host-specific silences for this host, or instance-wide silences (hostId IS NULL)
      // We use a raw SQL OR here via the Drizzle `or` helper imported above
      sql`(${alertSilences.hostId} = ${hostId} OR ${alertSilences.hostId} IS NULL)`,
    ),
  })
}

export async function createSilence(
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  const session = await requireInstanceWriteAccess(instanceId)
  const parsed = createSilenceSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  try {
    const [row] = await db
      .insert(alertSilences)
      .values({
        instanceId: instanceId,
        hostId: data.hostId ?? null,
        ruleId: data.ruleId ?? null,
        reason: data.reason,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        createdBy: session.user.id,
      })
      .returning({ id: alertSilences.id })

    if (!row) return { error: 'Insert failed' }
    await writeAuditEvent(db, {
      instanceId: instanceId,
      actorUserId: session.user.id,
      action: 'alert_silence.created',
      targetType: 'alert_silence',
      targetId: row.id,
      summary: `Created alert silence${data.hostId ? ` for host ${data.hostId}` : ''}`,
      metadata: {
        hostId: data.hostId ?? null,
        ruleId: data.ruleId ?? null,
        reason: data.reason,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
      },
    })
    return { success: true, id: row.id }
  } catch {
    return { error: 'Failed to create silence' }
  }
}

export async function deleteSilence(
  silenceId: string,
): Promise<{ success: true } | { error: string }> {
  const instanceId = await resolveCurrentAlertScope()
  await requireInstanceWriteAccess(instanceId)
  const existing = await db.query.alertSilences.findFirst({
    where: and(
      eq(alertSilences.id, silenceId),
      eq(alertSilences.instanceId, instanceId),
      isNull(alertSilences.deletedAt),
    ),
  })
  if (!existing) return { error: 'Silence not found' }

  await db
    .update(alertSilences)
    .set({ deletedAt: new Date() })
    .where(and(eq(alertSilences.id, silenceId), eq(alertSilences.instanceId, instanceId)))

  return { success: true }
}
