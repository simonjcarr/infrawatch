import { pgTable, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { z } from 'zod'
import { DEFAULT_NOTIFICATION_ROLES } from '../../auth/roles.ts'
import type { HostCollectionSettings } from './hosts.ts'
import { smtpRelaySettingsSchema, type SmtpRelaySettings } from '../../notifications/smtp-settings.ts'

export interface OrgNotificationSettings {
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

export interface OrgMetadata {
  defaultCollectionSettings?: HostCollectionSettings
  defaultTags?: Array<{ key: string; value: string }>
  terminalEnabled?: boolean
  terminalLoggingEnabled?: boolean
  terminalDirectAccess?: boolean
  notificationSettings?: OrgNotificationSettings
  softwareInventorySettings?: SoftwareInventorySettings
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

const orgNotificationSettingsSchema = z.object({
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

export const orgMetadataSchema = z.object({
  defaultCollectionSettings: hostCollectionSettingsSchema.optional().catch(undefined),
  defaultTags: z.array(tagPairSchema).catch([]).optional(),
  terminalEnabled: z.boolean().optional().catch(undefined),
  terminalLoggingEnabled: z.boolean().optional().catch(undefined),
  terminalDirectAccess: z.boolean().optional().catch(undefined),
  notificationSettings: orgNotificationSettingsSchema.optional().catch(undefined),
  softwareInventorySettings: softwareInventorySettingsSchema.optional().catch(undefined),
}).strip()

export function parseOrgMetadata(input: unknown): OrgMetadata {
  const parsed = orgMetadataSchema.safeParse(input)
  if (!parsed.success) {
    return {}
  }
  return parsed.data
}

export const organisations = pgTable('organisations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
  licenceTier: text('licence_tier').notNull().default('community'),
  licenceKey: text('licence_key'),
  metricRetentionDays: integer('metric_retention_days').notNull().default(30),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<OrgMetadata>(),
})

export type Organisation = typeof organisations.$inferSelect
export type NewOrganisation = typeof organisations.$inferInsert
