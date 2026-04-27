import { z } from 'zod'

export const SMTP_ALLOWED_PORTS = [25, 465, 587, 2525] as const

export const smtpEncryptionSchema = z.enum(['none', 'starttls', 'tls'])

export type SmtpEncryption = z.infer<typeof smtpEncryptionSchema>

export interface SmtpRelaySettings {
  enabled: boolean
  host: string
  port: number
  encryption: SmtpEncryption
  username?: string
  passwordEncrypted?: string
  fromAddress: string
  fromName?: string
}

export interface SmtpRelaySettingsSafe {
  enabled: boolean
  host: string
  port: number
  encryption: SmtpEncryption
  username?: string
  hasPassword: boolean
  fromAddress: string
  fromName?: string
}

export const smtpRelaySettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().min(1),
  port: z
    .number()
    .int()
    .refine((p) => (SMTP_ALLOWED_PORTS as readonly number[]).includes(p), {
      message: `SMTP port must be one of: ${SMTP_ALLOWED_PORTS.join(', ')}`,
    }),
  encryption: smtpEncryptionSchema,
  username: z.string().optional().catch(undefined),
  passwordEncrypted: z.string().optional().catch(undefined),
  fromAddress: z.string().email(),
  fromName: z.string().optional().catch(undefined),
}).strip()

export function normaliseSmtpRecipients(input: string): string[] {
  const recipients = input
    .split(',')
    .map((addr) => addr.trim())
    .filter(Boolean)

  if (recipients.length === 0) {
    throw new Error('At least one recipient is required')
  }

  const emailSchema = z.string().email()
  for (const recipient of recipients) {
    const parsed = emailSchema.safeParse(recipient)
    if (!parsed.success) {
      throw new Error(`${recipient} is not a valid email address`)
    }
  }

  return recipients
}

export function sanitiseSmtpRelayForClient(settings?: SmtpRelaySettings): SmtpRelaySettingsSafe | null {
  if (!settings) return null
  return {
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    encryption: settings.encryption,
    username: settings.username,
    hasPassword: !!settings.passwordEncrypted,
    fromAddress: settings.fromAddress,
    fromName: settings.fromName,
  }
}
