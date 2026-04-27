import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import nodemailer from 'nodemailer'

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

async function captureEmail(input: AuthEmailInput): Promise<void> {
  const file = process.env['AUTH_EMAIL_CAPTURE_FILE']
  if (!file) return

  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify(input)}
`, 'utf8')
}

export async function sendAuthEmail(input: AuthEmailInput): Promise<void> {
  const host = process.env['AUTH_EMAIL_SMTP_HOST']
  const port = Number(process.env['AUTH_EMAIL_SMTP_PORT'] ?? '587')
  const secure = parseBoolean(process.env['AUTH_EMAIL_SMTP_SECURE'], port === 465)
  const user = process.env['AUTH_EMAIL_SMTP_USER']
  const password = process.env['AUTH_EMAIL_SMTP_PASSWORD']
  const fromAddress = process.env['AUTH_EMAIL_FROM']
  const fromName = process.env['AUTH_EMAIL_FROM_NAME'] ?? 'CT-Ops'

  if (host && fromAddress) {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user ? { auth: { user, pass: password ?? '' } } : {}),
    })

    await transporter.sendMail({
      from: fromName ? `"${fromName}" <${fromAddress}>` : fromAddress,
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
  })
}
