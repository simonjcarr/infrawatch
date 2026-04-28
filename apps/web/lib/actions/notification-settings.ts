'use server'

import { requireOrgAccess, requireOrgAdminAccess } from '@/lib/actions/action-auth'

import { z } from 'zod'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { parseOrgMetadata } from '@/lib/db/schema/organisations'
import type { OrgNotificationSettings } from '@/lib/db/schema/organisations'
import { DEFAULT_NOTIFICATION_ROLES } from '@/lib/auth/roles'
import { encrypt, decrypt } from '@/lib/crypto/encrypt'
import { assertPublicHost } from '@/lib/net/ssrf-guard'
import {
  SMTP_ALLOWED_PORTS,
  normaliseSmtpTestRecipient,
  sanitiseSmtpRelayForClient,
  smtpEncryptionSchema,
  type SmtpRelaySettings,
  type SmtpRelaySettingsSafe,
} from '@/lib/notifications/smtp-settings'
import { sendSmtpMessage } from '@/lib/notifications/smtp-send'
import { createRateLimiter } from '@/lib/rate-limit'

const smtpRelayTestLimiter = createRateLimiter({
  scope: 'notifications:smtp-relay-test',
  windowMs: 60_000,
  max: 5,
})

const updateOrgNotificationSettingsSchema = z.object({
  inAppEnabled: z.boolean(),
  inAppRoles: z.array(z.string()).min(1, 'At least one role must be selected'),
  allowUserOptOut: z.boolean(),
})

export type OrgNotificationSettingsInput = z.infer<typeof updateOrgNotificationSettingsSchema>

export interface OrgNotificationSettingsFull {
  inAppEnabled: boolean
  inAppRoles: string[]
  allowUserOptOut: boolean
}

const updateOrgSmtpRelaySettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().min(1, 'Host is required'),
  port: z
    .number()
    .int()
    .refine((p) => (SMTP_ALLOWED_PORTS as readonly number[]).includes(p), {
      message: `SMTP port must be one of: ${SMTP_ALLOWED_PORTS.join(', ')}`,
    }),
  encryption: smtpEncryptionSchema,
  username: z.string().optional(),
  password: z.string().optional(),
  fromAddress: z.string().email('From address must be a valid email'),
  fromName: z.string().optional(),
})

export type OrgSmtpRelaySettingsInput = z.infer<typeof updateOrgSmtpRelaySettingsSchema>

export interface SmtpRelayTestLogEntry {
  level: 'info' | 'success' | 'error'
  message: string
}

export async function getOrgNotificationSettings(
  orgId: string,
): Promise<OrgNotificationSettingsFull> {
  await requireOrgAccess(orgId)
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  const meta = parseOrgMetadata(org?.metadata)
  const ns = meta.notificationSettings ?? {}
  return {
    inAppEnabled: ns.inAppEnabled !== false,
    inAppRoles: ns.inAppRoles ?? [...DEFAULT_NOTIFICATION_ROLES],
    allowUserOptOut: ns.allowUserOptOut !== false,
  }
}

export async function updateOrgNotificationSettings(
  orgId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  try {
    await requireOrgAdminAccess(orgId)
  } catch {
    return { error: 'You do not have permission to update notification settings' }
  }

  const parsed = updateOrgNotificationSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { inAppEnabled, inAppRoles, allowUserOptOut } = parsed.data

  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  if (!org) return { error: 'Organisation not found' }

  const currentMetadata = parseOrgMetadata(org.metadata)
  const updatedMetadata = {
    ...currentMetadata,
    notificationSettings: {
      inAppEnabled,
      inAppRoles,
      allowUserOptOut,
    } satisfies OrgNotificationSettings,
  }

  try {
    await db
      .update(organisations)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(organisations.id, orgId))
    return { success: true }
  } catch {
    return { error: 'Failed to update notification settings' }
  }
}

export async function getOrgSmtpRelaySettings(
  orgId: string,
): Promise<SmtpRelaySettingsSafe | null> {
  await requireOrgAccess(orgId)
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  const meta = parseOrgMetadata(org?.metadata)
  return sanitiseSmtpRelayForClient(meta.notificationSettings?.smtpRelay)
}

async function getAdminOrgMetadata(orgId: string): Promise<
  | { metadata: ReturnType<typeof parseOrgMetadata>; error?: undefined }
  | { metadata?: undefined; error: string }
> {
  try {
    await requireOrgAdminAccess(orgId)
  } catch {
    return { error: 'You do not have permission to update SMTP settings' }
  }

  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  if (!org) return { error: 'Organisation not found' }

  return { metadata: parseOrgMetadata(org.metadata) }
}

export async function updateOrgSmtpRelaySettings(
  orgId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const access = await getAdminOrgMetadata(orgId)
  if ('error' in access) return { error: access.error ?? 'Unable to load SMTP settings' }

  const parsed = updateOrgSmtpRelaySettingsSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const existing = access.metadata.notificationSettings?.smtpRelay
  const { password, username, fromName, ...data } = parsed.data
  if (data.enabled) {
    try {
      await assertPublicHost(data.host)
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'SMTP host is not allowed' }
    }
  }
  const smtpRelay: SmtpRelaySettings = {
    ...data,
    username: username || undefined,
    passwordEncrypted: password ? encrypt(password) : existing?.passwordEncrypted,
    fromName: fromName || undefined,
  }

  const updatedMetadata = {
    ...access.metadata,
    notificationSettings: {
      ...access.metadata.notificationSettings,
      smtpRelay,
    } satisfies OrgNotificationSettings,
  }

  try {
    await db
      .update(organisations)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(organisations.id, orgId))
    return { success: true }
  } catch {
    return { error: 'Failed to update SMTP settings' }
  }
}

export async function sendTestSmtpRelaySettings(
  orgId: string,
  recipientInput: unknown,
): Promise<{ success: true; log: SmtpRelayTestLogEntry[] } | { error: string; log: SmtpRelayTestLogEntry[] }> {
  const log: SmtpRelayTestLogEntry[] = []
  const access = await getAdminOrgMetadata(orgId)
  if ('error' in access) {
    return {
      error: access.error ?? 'Unable to load SMTP settings',
      log: [{ level: 'error', message: access.error ?? 'Unable to load SMTP settings' }],
    }
  }
  if (!await smtpRelayTestLimiter.check(orgId)) {
    return {
      error: 'Too many requests — please wait before sending another SMTP test.',
      log: [{ level: 'error', message: 'SMTP test rate limit exceeded' }],
    }
  }

  let recipient: string
  try {
    recipient = normaliseSmtpTestRecipient(recipientInput)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Enter a valid email address'
    return { error: message, log: [{ level: 'error', message }] }
  }
  log.push({ level: 'info', message: `Recipient: ${recipient}` })

  const cfg = access.metadata.notificationSettings?.smtpRelay
  if (!cfg?.enabled) {
    log.push({ level: 'error', message: 'SMTP relay is not enabled' })
    return { error: 'SMTP relay is not enabled', log }
  }

  log.push({ level: 'info', message: `Relay: ${cfg.host}:${cfg.port} (${cfg.encryption.toUpperCase()})` })
  log.push({ level: 'info', message: `Sender: ${cfg.fromAddress}` })

  try {
    await assertPublicHost(cfg.host)
    log.push({ level: 'info', message: 'Relay host passed public host validation' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SMTP host is not allowed'
    log.push({ level: 'error', message })
    return { error: message, log }
  }

  let password = ''
  if (cfg.passwordEncrypted) {
    try {
      password = decrypt(cfg.passwordEncrypted)
    } catch {
      log.push({ level: 'error', message: 'Stored SMTP password could not be decrypted' })
      return { error: 'Stored SMTP password could not be decrypted', log }
    }
  }
  log.push({ level: 'info', message: cfg.username ? `Authentication: enabled as ${cfg.username}` : 'Authentication: disabled' })
  log.push({ level: 'info', message: 'Sending SMTP test message' })

  try {
    await sendSmtpMessage({
      host: cfg.host,
      port: cfg.port,
      encryption: cfg.encryption,
      username: cfg.username,
      password,
      fromAddress: cfg.fromAddress,
      fromName: cfg.fromName,
    }, {
      to: [recipient],
      subject: 'CT-Ops SMTP Test',
      text: 'This is a test email from CT-Ops. Your central SMTP relay is configured correctly.',
      html: '<p>This is a test email from <strong>CT-Ops</strong>. Your central SMTP relay is configured correctly.</p>',
    })
    log.push({ level: 'success', message: 'SMTP server accepted the test message' })
    return { success: true, log }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send SMTP test'
    log.push({ level: 'error', message })
    return { error: message, log }
  }
}
