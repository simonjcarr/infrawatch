'use server'

import { z } from 'zod'
import { createHmac } from 'crypto'
import nodemailer from 'nodemailer'
import { createRateLimiter } from '@/lib/rate-limit'

const testNotificationLimiter = createRateLimiter(60_000, 5)
import { db } from '@/lib/db'
import { alertRules, alertInstances, notificationChannels, alertSilences, hosts } from '@/lib/db/schema'
import { eq, and, isNull, desc, inArray, sql, lte, gte, count } from 'drizzle-orm'
import type {
  AlertRule,
  AlertInstance,
  AlertInstanceStatus,
  AlertSeverity,
  AlertRuleConfig,
  NotificationChannel,
  WebhookChannelConfig,
  SmtpChannelConfig,
  SmtpEncryption,
  SlackChannelConfig,
  TelegramChannelConfig,
  AlertSilence,
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

const certExpiryConfigSchema = z.object({
  scope: z.enum(['all', 'specific']),
  certificateId: z.string().min(1).optional(),
  daysBeforeExpiry: z.number().int().min(1).max(365),
})

const createAlertRuleSchema = z.object({
  hostId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(100),
  conditionType: z.enum(['check_status', 'metric_threshold', 'cert_expiry']),
  config: z.union([checkStatusConfigSchema, metricThresholdConfigSchema, certExpiryConfigSchema]),
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
})

const updateAlertRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  config: z.union([checkStatusConfigSchema, metricThresholdConfigSchema, certExpiryConfigSchema]).optional(),
})

const smtpEncryptionSchema = z.enum(['none', 'starttls', 'tls'])

// Standard SMTP submission ports. Port 25 (server-to-server relay) is included
// for self-hosted mail servers; 465 (SMTPS), 587 (submission), 2525 (alt).
const SMTP_ALLOWED_PORTS = [25, 465, 587, 2525] as const

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
      host: z.string().min(1),
      port: z
        .number()
        .int()
        .refine((p) => (SMTP_ALLOWED_PORTS as readonly number[]).includes(p), {
          message: `SMTP port must be one of: ${SMTP_ALLOWED_PORTS.join(', ')}`,
        }),
      encryption: smtpEncryptionSchema,
      username: z.string().optional(),
      password: z.string().optional(),
      fromAddress: z.string().email(),
      fromName: z.string().optional(),
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
  orgId: string,
  filters: AlertHistoryFilters = {},
): Promise<AlertInstanceWithRule[]> {
  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0

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
  orgId: string,
  filters: Omit<AlertHistoryFilters, 'limit' | 'offset'> = {},
): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(alertInstances)
    .innerJoin(alertRules, eq(alertInstances.ruleId, alertRules.id))
    .where(
      and(
        eq(alertInstances.organisationId, orgId),
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
  | {
      type: 'smtp'
      config: {
        host: string
        port: number
        encryption: SmtpEncryption
        username?: string
        fromAddress: string
        fromName?: string
        toAddresses: string[]
        hasPassword: boolean
      }
    }
  | { type: 'slack'; config: { webhookUrl: string } }
  | { type: 'telegram'; config: { chatId: string; hasBotToken: boolean } }
)

/** Normalise SMTP config rows written before the encryption field was introduced. */
function normaliseSmtpConfig(raw: unknown): SmtpChannelConfig {
  const obj = raw as Record<string, unknown>
  if (obj.encryption !== undefined) return obj as unknown as SmtpChannelConfig
  // Rows written with the old `secure: boolean` field
  const encryption: SmtpEncryption = obj.secure ? 'tls' : 'starttls'
  const { secure: _removed, ...rest } = obj
  return { ...rest, encryption } as unknown as SmtpChannelConfig
}

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
      const cfg = normaliseSmtpConfig(ch.config)
      return {
        ...ch,
        type: 'smtp' as const,
        config: {
          host: cfg.host,
          port: cfg.port,
          encryption: cfg.encryption,
          username: cfg.username,
          fromAddress: cfg.fromAddress,
          fromName: cfg.fromName,
          toAddresses: cfg.toAddresses,
          hasPassword: !!(cfg.password),
        },
      }
    }
    if (ch.type === 'slack') {
      const cfg = ch.config as SlackChannelConfig
      return {
        ...ch,
        type: 'slack' as const,
        config: { webhookUrl: cfg.webhookUrl },
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

const updateWebhookChannelSchema = z.object({
  name: z.string().min(1).max(100),
  url: httpsUrl,
  secret: z.string().optional(),
})

const updateSmtpChannelSchema = z.object({
  name: z.string().min(1).max(100),
  host: z.string().min(1),
  port: z
    .number()
    .int()
    .refine((p) => (SMTP_ALLOWED_PORTS as readonly number[]).includes(p), {
      message: `SMTP port must be one of: ${SMTP_ALLOWED_PORTS.join(', ')}`,
    }),
  encryption: smtpEncryptionSchema,
  username: z.string().optional(),
  password: z.string().optional(),
  fromAddress: z.string().email(),
  fromName: z.string().optional(),
  toAddresses: z.array(z.string().email()).min(1),
})

const updateSlackChannelSchema = z.object({
  name: z.string().min(1).max(100),
  webhookUrl: httpsUrl,
})

const updateTelegramChannelSchema = z.object({
  name: z.string().min(1).max(100),
  botToken: z.string().optional(),
  chatId: z.string().min(1),
})

export async function updateNotificationChannel(
  orgId: string,
  channelId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const existing = await db.query.notificationChannels.findFirst({
    where: and(
      eq(notificationChannels.id, channelId),
      eq(notificationChannels.organisationId, orgId),
      isNull(notificationChannels.deletedAt),
    ),
  })
  if (!existing) return { error: 'Notification channel not found' }

  try {
    if (existing.type === 'webhook') {
      const parsed = updateWebhookChannelSchema.safeParse(input)
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
      const { name, url, secret } = parsed.data
      const existingConfig = existing.config as WebhookChannelConfig
      const newConfig: WebhookChannelConfig = {
        url,
        secret: secret || existingConfig.secret,
      }
      await db
        .update(notificationChannels)
        .set({ name, config: newConfig, updatedAt: new Date() })
        .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.organisationId, orgId)))
    } else if (existing.type === 'smtp') {
      const parsed = updateSmtpChannelSchema.safeParse(input)
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
      const { name, host, port, encryption, username, password, fromAddress, fromName, toAddresses } = parsed.data
      const existingConfig = normaliseSmtpConfig(existing.config)
      const newConfig: SmtpChannelConfig = {
        host,
        port,
        encryption,
        username: username || undefined,
        password: password || existingConfig.password,
        fromAddress,
        fromName: fromName || undefined,
        toAddresses,
      }
      await db
        .update(notificationChannels)
        .set({ name, config: newConfig, updatedAt: new Date() })
        .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.organisationId, orgId)))
    } else if (existing.type === 'slack') {
      const parsed = updateSlackChannelSchema.safeParse(input)
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
      const { name, webhookUrl } = parsed.data
      const newConfig: SlackChannelConfig = { webhookUrl }
      await db
        .update(notificationChannels)
        .set({ name, config: newConfig, updatedAt: new Date() })
        .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.organisationId, orgId)))
    } else if (existing.type === 'telegram') {
      const parsed = updateTelegramChannelSchema.safeParse(input)
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
      const { name, botToken, chatId } = parsed.data
      const existingConfig = existing.config as TelegramChannelConfig
      const newConfig: TelegramChannelConfig = {
        botToken: botToken || existingConfig.botToken,
        chatId,
      }
      await db
        .update(notificationChannels)
        .set({ name, config: newConfig, updatedAt: new Date() })
        .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.organisationId, orgId)))
    }
    return { success: true }
  } catch {
    return { error: 'Failed to update notification channel' }
  }
}

export async function sendTestNotification(
  orgId: string,
  channelId: string,
): Promise<{ success: true } | { error: string }> {
  if (!testNotificationLimiter.check(orgId)) {
    return { error: 'Too many requests — please wait before sending another test notification.' }
  }
  const existing = await db.query.notificationChannels.findFirst({
    where: and(
      eq(notificationChannels.id, channelId),
      eq(notificationChannels.organisationId, orgId),
      isNull(notificationChannels.deletedAt),
    ),
  })
  if (!existing) return { error: 'Notification channel not found' }

  if (existing.type === 'webhook') {
    const cfg = existing.config as WebhookChannelConfig
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
    const cfg = normaliseSmtpConfig(existing.config)
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.encryption === 'tls',
      requireTLS: cfg.encryption === 'starttls',
      auth: cfg.username ? { user: cfg.username, pass: cfg.password ?? '' } : undefined,
    })

    try {
      await transporter.sendMail({
        from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress,
        to: cfg.toAddresses.join(', '),
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

export async function getSilences(orgId: string): Promise<AlertSilenceWithHost[]> {
  const rows = await db
    .select({
      id: alertSilences.id,
      organisationId: alertSilences.organisationId,
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
        eq(alertSilences.organisationId, orgId),
        isNull(alertSilences.deletedAt),
      ),
    )
    .orderBy(desc(alertSilences.startsAt))

  return rows
}

export async function getActiveSilencesForHost(
  orgId: string,
  hostId: string,
): Promise<AlertSilence[]> {
  const now = new Date()
  return db.query.alertSilences.findMany({
    where: and(
      eq(alertSilences.organisationId, orgId),
      isNull(alertSilences.deletedAt),
      lte(alertSilences.startsAt, now),
      gte(alertSilences.endsAt, now),
      // match host-specific silences for this host, or org-wide silences (hostId IS NULL)
      // We use a raw SQL OR here via the Drizzle `or` helper imported above
      sql`(${alertSilences.hostId} = ${hostId} OR ${alertSilences.hostId} IS NULL)`,
    ),
  })
}

export async function createSilence(
  orgId: string,
  userId: string,
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const parsed = createSilenceSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  try {
    const [row] = await db
      .insert(alertSilences)
      .values({
        organisationId: orgId,
        hostId: data.hostId ?? null,
        ruleId: data.ruleId ?? null,
        reason: data.reason,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        createdBy: userId,
      })
      .returning({ id: alertSilences.id })

    if (!row) return { error: 'Insert failed' }
    return { success: true, id: row.id }
  } catch {
    return { error: 'Failed to create silence' }
  }
}

export async function deleteSilence(
  orgId: string,
  silenceId: string,
): Promise<{ success: true } | { error: string }> {
  const existing = await db.query.alertSilences.findFirst({
    where: and(
      eq(alertSilences.id, silenceId),
      eq(alertSilences.organisationId, orgId),
      isNull(alertSilences.deletedAt),
    ),
  })
  if (!existing) return { error: 'Silence not found' }

  await db
    .update(alertSilences)
    .set({ deletedAt: new Date() })
    .where(and(eq(alertSilences.id, silenceId), eq(alertSilences.organisationId, orgId)))

  return { success: true }
}
