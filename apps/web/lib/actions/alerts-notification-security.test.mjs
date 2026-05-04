import test from 'node:test'
import assert from 'node:assert/strict'

import { validateStoredNotificationChannelConfig } from './alerts-notification-security.ts'

test('validateStoredNotificationChannelConfig rejects private webhook targets', async () => {
  await assert.rejects(
    () => validateStoredNotificationChannelConfig('webhook', { url: 'https://127.0.0.1/hooks' }),
    /private or reserved address/,
  )
})

test('validateStoredNotificationChannelConfig rejects private Slack webhook targets', async () => {
  await assert.rejects(
    () => validateStoredNotificationChannelConfig('slack', { webhookUrl: 'https://[::1]/slack' }),
    /private or reserved address/,
  )
})

test('validateStoredNotificationChannelConfig allows public webhook and slack targets', async () => {
  await assert.doesNotReject(() =>
    validateStoredNotificationChannelConfig('webhook', { url: 'https://8.8.8.8/hooks' }),
  )
  await assert.doesNotReject(() =>
    validateStoredNotificationChannelConfig('slack', { webhookUrl: 'https://8.8.8.8/slack' }),
  )
})

test('validateStoredNotificationChannelConfig ignores smtp and telegram configs', async () => {
  await assert.doesNotReject(() =>
    validateStoredNotificationChannelConfig('smtp', { toAddresses: ['ops@example.com'] }),
  )
  await assert.doesNotReject(() =>
    validateStoredNotificationChannelConfig('telegram', { botToken: 'bot-token', chatId: '123' }),
  )
})
