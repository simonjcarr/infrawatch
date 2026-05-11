import { pgTable, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { z } from 'zod'
import { DEFAULT_NOTIFICATION_ROLES } from '../../auth/roles.ts'
import type { HostCollectionSettings } from './hosts.ts'
import { smtpRelaySettingsSchema, type SmtpRelaySettings } from '../../notifications/smtp-settings.ts'
import { normaliseFeatureFlagOverrides, type FeatureFlagOverrides } from '../../feature-flags.ts'

export interface InstanceNotificationSettings {
  inAppEnabled?: boolean      // default true — master switch for in-app notifications
  inAppRoles?: string[]       // default ['super_admin','org_admin','engineer']
  allowUserOptOut?: boolean   // default true — whether users can individually opt out
  smtpRelay?: SmtpRelaySettings
}

export interface SoftwareInventorySettings {
  enabled: boolean
  intervalHours: number          // default 24
  includeSnapFlatpak?: boolean
  includeWindowsStore?: boolean
}

export interface InstanceSecuritySettings {
  requireTwoFactor?: boolean
}

export interface InstanceAutomationSettings {
  provider: 'none' | 'ansible'
}

export interface InstanceMetadata {
  defaultCollectionSettings?: HostCollectionSettings
  defaultTags?: Array<{ key: string; value: string }>
  freeSeatUserIds?: string[]
  featureFlags?: FeatureFlagOverrides
  automationSettings?: InstanceAutomationSettings
  terminalEnabled?: boolean
  terminalLoggingEnabled?: boolean
  terminalDirectAccess?: boolean
  notificationSettings?: InstanceNotificationSettings
  softwareInventorySettings?: SoftwareInventorySettings
  securitySettings?: InstanceSecuritySettings
}

const tagPairSchema = z.object({
  key: z.string(),
  value: z.string(),
}).strip()

const hostCollectionSettingsSchema = z.object({
  cpu: z.boolean().catch(true),
  memory: z.boolean().catch(true),
  disk: z.boolean().catch(true),
  localUsers: z.boolean().catch(false),
  localUserConfig: z.object({
    mode: z.enum(['all', 'selected']).catch('all'),
    selectedUsernames: z.array(z.string()).catch([]).optional(),
  }).strip().optional().catch(undefined),
}).strip()

const instanceNotificationSettingsSchema = z.object({
  inAppEnabled: z.boolean().optional().catch(undefined),
  inAppRoles: z.array(z.string()).catch([...DEFAULT_NOTIFICATION_ROLES]).optional(),
  allowUserOptOut: z.boolean().optional().catch(undefined),
  smtpRelay: smtpRelaySettingsSchema.optional().catch(undefined),
}).strip()

const softwareInventorySettingsSchema = z.object({
  enabled: z.boolean(),
  intervalHours: z.number().int(),
  includeSnapFlatpak: z.boolean().optional().catch(undefined),
  includeWindowsStore: z.boolean().optional().catch(undefined),
}).strip()

const instanceSecuritySettingsSchema = z.object({
  requireTwoFactor: z.boolean().optional().catch(undefined),
}).strip()

const instanceAutomationSettingsSchema = z.object({
  provider: z.enum(['none', 'ansible']).catch('none'),
}).strip()

export const instanceMetadataSchema = z.object({
  defaultCollectionSettings: hostCollectionSettingsSchema.optional().catch(undefined),
  defaultTags: z.array(tagPairSchema).catch([]).optional(),
  freeSeatUserIds: z.array(z.string()).max(3).catch([]).optional(),
  featureFlags: z.preprocess(normaliseFeatureFlagOverrides, z.record(z.string(), z.boolean())).optional().catch(undefined),
  automationSettings: instanceAutomationSettingsSchema.optional().catch(undefined),
  terminalEnabled: z.boolean().optional().catch(undefined),
  terminalLoggingEnabled: z.boolean().optional().catch(undefined),
  terminalDirectAccess: z.boolean().optional().catch(undefined),
  notificationSettings: instanceNotificationSettingsSchema.optional().catch(undefined),
  softwareInventorySettings: softwareInventorySettingsSchema.optional().catch(undefined),
  securitySettings: instanceSecuritySettingsSchema.optional().catch(undefined),
}).strip()

export function parseInstanceMetadata(input: unknown): InstanceMetadata {
  const parsed = instanceMetadataSchema.safeParse(input)
  if (!parsed.success) {
    return {}
  }
  return parsed.data
}

export const instanceSettings = pgTable('instance_settings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
  licenceTier: text('licence_tier').notNull().default('community'),
  licenceKey: text('licence_key'),
  licenceVerifierPublicKey: text('licence_verifier_public_key'),
  licenceVerifierPublicKeyFingerprint: text('licence_verifier_public_key_fingerprint'),
  metricRetentionDays: integer('metric_retention_days').notNull().default(30),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<InstanceMetadata>(),
})

export type InstanceSettings = typeof instanceSettings.$inferSelect
export type NewInstanceSettings = typeof instanceSettings.$inferInsert
export type Instance = InstanceSettings
export type NewInstance = NewInstanceSettings
