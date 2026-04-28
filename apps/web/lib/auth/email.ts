import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import nodemailer from 'nodemailer'
import { decrypt } from '../crypto/encrypt.ts'
import type { OrgNotificationSettings } from '../db/schema/organisations.ts'
import type { SmtpSendConfig } from '../notifications/smtp-send.ts'

type AuthEmailInput = {
  to: string
  subject: string
  text: string
  html: string
  metadata?: Record<string, string>
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

export function getAuthEmailConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SmtpSendConfig | null {
  const host = env['AUTH_EMAIL_SMTP_HOST']
  const fromAddress = env['AUTH_EMAIL_FROM']
  if (!host || !fromAddress) return null

  const port = Number(env['AUTH_EMAIL_SMTP_PORT'] ?? '587')
  return {
    host,
    port,
    encryption: parseBoolean(env['AUTH_EMAIL_SMTP_SECURE'], port === 465) ? 'tls' : 'none',
    username: env['AUTH_EMAIL_SMTP_USER'] || undefined,
    password: env['AUTH_EMAIL_SMTP_PASSWORD'] || undefined,
    fromAddress,
    fromName: env['AUTH_EMAIL_FROM_NAME'] ?? 'CT-Ops',
  }
}

export function getAuthEmailConfigFromOrgSettings(
  notificationSettings: OrgNotificationSettings | undefined,
): SmtpSendConfig | null {
  const relay = notificationSettings?.smtpRelay
  if (!relay?.enabled) return null

  return {
    host: relay.host,
    port: relay.port,
    encryption: relay.encryption,
    username: relay.username || undefined,
    password: relay.passwordEncrypted ? decrypt(relay.passwordEncrypted) : undefined,
    fromAddress: relay.fromAddress,
    fromName: relay.fromName || undefined,
  }
}

async function captureEmail(input: AuthEmailInput): Promise<void> {
  const file = process.env['AUTH_EMAIL_CAPTURE_FILE']
  if (!file) return

  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify(input)}
`, 'utf8')
}

export async function sendAuthEmail(
  input: AuthEmailInput,
  smtpConfig: SmtpSendConfig | null = null,
): Promise<void> {
  const config = smtpConfig ?? getAuthEmailConfigFromEnv()

  if (config) {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.encryption === 'tls',
      requireTLS: config.encryption === 'starttls',
      ...(config.username ? { auth: { user: config.username, pass: config.password ?? '' } } : {}),
    })

    await transporter.sendMail({
      from: config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    })

    await captureEmail(input)
    return
  }

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'AUTH_EMAIL_SMTP_HOST and AUTH_EMAIL_FROM must be configured when email verification is enabled.',
    )
  }

  console.log('[auth-email]', JSON.stringify(input))
  await captureEmail(input)
}

export async function sendVerificationEmail(input: {
  email: string
  name: string
  verificationUrl: string
  smtpConfig?: SmtpSendConfig | null
}): Promise<void> {
  const subject = 'Verify your CT-Ops email address'
  const text = [
    `Hi ${input.name || 'there'},`,
    '',
    'Verify your email address to finish setting up your CT-Ops account:',
    input.verificationUrl,
    '',
    'If you did not create this account, you can ignore this email.',
  ].join('\n')

  const html = [
    `<p>Hi ${input.name || 'there'},</p>`,
    '<p>Verify your email address to finish setting up your CT-Ops account:</p>',
    `<p><a href="${input.verificationUrl}">Verify email address</a></p>`,
    `<p>If the button does not work, use this link:<br /><a href="${input.verificationUrl}">${input.verificationUrl}</a></p>`,
    '<p>If you did not create this account, you can ignore this email.</p>',
  ].join('')

  await sendAuthEmail({
    to: input.email,
    subject,
    text,
    html,
    metadata: { verificationUrl: input.verificationUrl },
  }, input.smtpConfig ?? null)
}

export async function sendPasswordResetEmail(input: {
  email: string
  name: string
  resetUrl: string
  smtpConfig?: SmtpSendConfig | null
}): Promise<void> {
  const subject = 'Reset your CT-Ops password'
  const text = [
    `Hi ${input.name || 'there'},`,
    '',
    'We received a request to reset your CT-Ops password.',
    'Use the link below to choose a new password:',
    input.resetUrl,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n')

  const html = [
    `<p>Hi ${input.name || 'there'},</p>`,
    '<p>We received a request to reset your CT-Ops password.</p>',
    `<p><a href="${input.resetUrl}">Reset password</a></p>`,
    `<p>If the button does not work, use this link:<br /><a href="${input.resetUrl}">${input.resetUrl}</a></p>`,
    '<p>If you did not request this, you can ignore this email.</p>',
  ].join('')

  await sendAuthEmail({
    to: input.email,
    subject,
    text,
    html,
    metadata: { resetUrl: input.resetUrl },
  }, input.smtpConfig ?? null)
}
