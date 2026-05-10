import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const alertsSource = readFileSync(path.join(here, 'alerts.ts'), 'utf8')

function getActionSegment(action) {
  const start = alertsSource.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist in alerts.ts`)
  const next = alertsSource.indexOf('\nexport ', start + 1)
  return alertsSource.slice(start, next === -1 ? undefined : next)
}

test('getNotificationChannels redacts Slack webhook URLs from client payloads', () => {
  const segment = getActionSegment('getNotificationChannels')
  const slackBranchStart = segment.indexOf("if (ch.type === 'slack')")
  assert.notEqual(slackBranchStart, -1, 'expected Slack notification branch to exist')
  const nextBranch = segment.indexOf("if (ch.type === 'telegram')", slackBranchStart)
  assert.notEqual(nextBranch, -1, 'expected Slack branch to be followed by Telegram branch')
  const slackBranch = segment.slice(slackBranchStart, nextBranch)

  assert.match(slackBranch, /hasWebhookUrl:\s*!!\(?cfg\.webhookUrl\)?/)
  assert.doesNotMatch(slackBranch, /config:\s*\{\s*webhookUrl:\s*cfg\.webhookUrl\s*\}/)
})

test('notification channel management actions require org admin access', () => {
  for (const action of [
    'createNotificationChannel',
    'deleteNotificationChannel',
    'updateNotificationChannel',
    'sendTestNotification',
  ]) {
    const segment = getActionSegment(action)

    assert.match(
      segment,
      /(?:const session = )?await requireInstanceAdminAccess\(instanceId\)/,
      `${action} must require org admin access before managing notification channels`,
    )
  }
})
