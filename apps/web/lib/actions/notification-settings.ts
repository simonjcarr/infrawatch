'use server'

import { requireInstanceAccess, requireInstanceAdminAccess } from '@/lib/actions/action-auth'

import { z } from 'zod'
import { db } from '@/lib/db'
import { instanceSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { parseInstanceMetadata } from '@/lib/db/schema/instance-settings'
import type { InstanceNotificationSettings } from '@/lib/db/schema/instance-settings'
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

const updateInstanceNotificationSettingsSchema = z.object({
  inAppEnabled: z.boolean(),
  inAppRoles: z.array(z.string()).min(1, 'At least one role must be selected'),
  allowUserOptOut: z.boolean(),
})

export type InstanceNotificationSettingsInput = z.infer<typeof updateInstanceNotificationSettingsSchema>

export interface InstanceNotificationSettingsFull {
  inAppEnabled: boolean
  inAppRoles: string[]
  allowUserOptOut: boolean
}

const updateInstanceSmtpRelaySettingsSchema = z.object({
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

export type InstanceSmtpRelaySettingsInput = z.infer<typeof updateInstanceSmtpRelaySettingsSchema>

export interface SmtpRelayTestLogEntry {
  level: 'info' | 'success' | 'error'
  message: string
}

export async function getInstanceNotificationSettings(
  instanceId: string,
): Promise<InstanceNotificationSettingsFull> {
  await requireInstanceAccess(instanceId)
  const instance = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })
  const meta = parseInstanceMetadata(instance?.metadata)
  const ns = meta.notificationSettings ?? {}
  return {
    inAppEnabled: ns.inAppEnabled !== false,
    inAppRoles: ns.inAppRoles ?? [...DEFAULT_NOTIFICATION_ROLES],
    allowUserOptOut: ns.allowUserOptOut !== false,
  }
}

export async function updateInstanceNotificationSettings(
  instanceId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  try {
    await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to update notification settings' }
  }

  const parsed = updateInstanceNotificationSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { inAppEnabled, inAppRoles, allowUserOptOut } = parsed.data

  const instance = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })
  if (!instance) return { error: 'Instance not found' }

  const currentMetadata = parseInstanceMetadata(instance.metadata)
  const updatedMetadata = {
    ...currentMetadata,
    notificationSettings: {
      inAppEnabled,
      inAppRoles,
      allowUserOptOut,
    } satisfies InstanceNotificationSettings,
  }

  try {
    await db
      .update(instanceSettings)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(instanceSettings.id, instanceId))
    return { success: true }
  } catch {
    return { error: 'Failed to update notification settings' }
  }
}

export async function getInstanceSmtpRelaySettings(
  instanceId: string,
): Promise<SmtpRelaySettingsSafe | null> {
  await requireInstanceAccess(instanceId)
  const instance = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })
  const meta = parseInstanceMetadata(instance?.metadata)
  return sanitiseSmtpRelayForClient(meta.notificationSettings?.smtpRelay)
}

async function getAdminInstanceMetadata(instanceId: string): Promise<
  | { metadata: ReturnType<typeof parseInstanceMetadata>; error?: undefined }
  | { metadata?: undefined; error: string }
> {
  try {
    await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to update SMTP settings' }
  }

  const instance = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })
  if (!instance) return { error: 'Instance not found' }

  return { metadata: parseInstanceMetadata(instance.metadata) }
}

export async function updateInstanceSmtpRelaySettings(
  instanceId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const access = await getAdminInstanceMetadata(instanceId)
  if ('error' in access) return { error: access.error ?? 'Unable to load SMTP settings' }

  const parsed = updateInstanceSmtpRelaySettingsSchema.safeParse(input)
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
    } satisfies InstanceNotificationSettings,
  }

  try {
    await db
      .update(instanceSettings)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(instanceSettings.id, instanceId))
    return { success: true }
  } catch {
    return { error: 'Failed to update SMTP settings' }
  }
}

export async function sendTestSmtpRelaySettings(
  instanceId: string,
  recipientInput: unknown,
): Promise<{ success: true; log: SmtpRelayTestLogEntry[] } | { error: string; log: SmtpRelayTestLogEntry[] }> {
  const log: SmtpRelayTestLogEntry[] = []
  const access = await getAdminInstanceMetadata(instanceId)
  if ('error' in access) {
    return {
      error: access.error ?? 'Unable to load SMTP settings',
      log: [{ level: 'error', message: access.error ?? 'Unable to load SMTP settings' }],
    }
  }
  if (!await smtpRelayTestLimiter.check(instanceId)) {
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
