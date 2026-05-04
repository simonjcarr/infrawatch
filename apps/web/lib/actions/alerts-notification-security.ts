import { assertPublicHost, assertPublicUrl } from '../net/ssrf-guard.ts'

import type {
  SlackChannelConfig,
  SmtpChannelConfig,
  TelegramChannelConfig,
  WebhookChannelConfig,
} from '../db/schema'

type StoredNotificationChannelType = 'webhook' | 'smtp' | 'slack' | 'telegram'

type StoredNotificationChannelConfig =
  | WebhookChannelConfig
  | SmtpChannelConfig
  | SlackChannelConfig
  | TelegramChannelConfig

export async function validateStoredNotificationChannelConfig(
  type: StoredNotificationChannelType,
  config: StoredNotificationChannelConfig,
): Promise<void> {
  switch (type) {
    case 'webhook':
      await assertPublicUrl((config as WebhookChannelConfig).url)
      return
    case 'slack':
      await assertPublicUrl((config as SlackChannelConfig).webhookUrl)
      return
    case 'smtp':
      if ('host' in config && typeof config.host === 'string' && config.host.length > 0) {
        await assertPublicHost(config.host)
      }
      return
    case 'telegram':
      return
  }
}
