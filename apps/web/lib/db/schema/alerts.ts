import { pgTable, text, timestamp, jsonb, boolean, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { hosts } from './hosts'
import { users } from './auth'

export interface CheckStatusConfig {
  checkId: string
  failureThreshold: number
}

export interface MetricThresholdConfig {
  metric: 'cpu' | 'memory' | 'disk'
  operator: 'gt' | 'lt'
  threshold: number
}

export interface CertExpiryConfig {
  certificateId?: string           // only set when scope === 'specific'
  scope: 'all' | 'specific'
  daysBeforeExpiry: number
}

export type AlertConditionType = 'check_status' | 'metric_threshold' | 'cert_expiry'
export type AlertRuleConfig = CheckStatusConfig | MetricThresholdConfig | CertExpiryConfig
export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertInstanceStatus = 'firing' | 'resolved' | 'acknowledged'

export interface WebhookChannelConfig {
  url: string
  secret?: string
}

export type SmtpEncryption = 'none' | 'starttls' | 'tls'

export interface SmtpChannelConfig {
  host: string
  port: number
  /** 'none' = plain, 'starttls' = STARTTLS on connect, 'tls' = direct SSL/TLS */
  encryption: SmtpEncryption
  username?: string
  password?: string
  fromAddress: string
  fromName?: string
  toAddresses: string[]
}

export type NotificationChannelType = 'webhook' | 'smtp'

export const alertRules = pgTable('alert_rules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  hostId: text('host_id').references(() => hosts.id),
  name: text('name').notNull(),
  conditionType: text('condition_type').notNull().$type<AlertConditionType>(),
  config: jsonb('config').notNull().$type<AlertRuleConfig>(),
  severity: text('severity').notNull().default('warning').$type<AlertSeverity>(),
  enabled: boolean('enabled').notNull().default(true),
  isGlobalDefault: boolean('is_global_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (table) => [
  index('alert_rules_org_host_idx').on(table.organisationId, table.hostId),
  index('alert_rules_org_enabled_idx').on(table.organisationId, table.enabled),
  index('alert_rules_org_global_idx').on(table.organisationId, table.isGlobalDefault),
])

export const alertInstances = pgTable('alert_instances', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  ruleId: text('rule_id').notNull().references(() => alertRules.id),
  hostId: text('host_id').notNull().references(() => hosts.id),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  status: text('status').notNull().default('firing').$type<AlertInstanceStatus>(),
  message: text('message').notNull(),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  acknowledgedBy: text('acknowledged_by'),
  metadata: jsonb('metadata'),
}, (table) => [
  index('alert_instances_org_status_idx').on(table.organisationId, table.status),
  index('alert_instances_rule_host_status_idx').on(table.ruleId, table.hostId, table.status),
])

export const notificationChannels = pgTable('notification_channels', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  name: text('name').notNull(),
  type: text('type').notNull().$type<NotificationChannelType>(),
  config: jsonb('config').notNull().$type<WebhookChannelConfig | SmtpChannelConfig>(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (table) => [
  index('notification_channels_org_enabled_idx').on(table.organisationId, table.enabled),
])

export const alertSilences = pgTable('alert_silences', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  hostId: text('host_id').references(() => hosts.id),      // null = org-wide silence
  ruleId: text('rule_id').references(() => alertRules.id), // null = silence all rules
  reason: text('reason').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (table) => [
  index('alert_silences_org_host_idx').on(table.organisationId, table.hostId),
  index('alert_silences_org_active_idx').on(table.organisationId, table.startsAt, table.endsAt),
])

export type AlertRule = typeof alertRules.$inferSelect
export type NewAlertRule = typeof alertRules.$inferInsert
export type AlertInstance = typeof alertInstances.$inferSelect
export type NewAlertInstance = typeof alertInstances.$inferInsert
export type NotificationChannel = typeof notificationChannels.$inferSelect
export type NewNotificationChannel = typeof notificationChannels.$inferInsert
export type AlertSilence = typeof alertSilences.$inferSelect
export type NewAlertSilence = typeof alertSilences.$inferInsert
