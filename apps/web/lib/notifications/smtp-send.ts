import nodemailer from 'nodemailer'
import type { SmtpEncryption } from './smtp-settings'

export interface SmtpSendConfig {
  host: string
  port: number
  encryption: SmtpEncryption
  username?: string
  password?: string
  fromAddress: string
  fromName?: string
}

export interface SmtpMessage {
  to: string[]
  subject: string
  text: string
  html: string
}

export async function sendSmtpMessage(config: SmtpSendConfig, message: SmtpMessage): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.encryption === 'tls',
    requireTLS: config.encryption === 'starttls',
    auth: config.username ? { user: config.username, pass: config.password ?? '' } : undefined,
  })

  await transporter.sendMail({
    from: config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress,
    to: message.to.join(', '),
    subject: message.subject,
    text: message.text,
    html: message.html,
  })
}
