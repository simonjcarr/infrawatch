import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const notificationsSource = readFileSync(path.join(here, 'notifications.ts'), 'utf8')

const userScopedActions = [
  'getNotifications',
  'getUnreadCount',
  'markAsRead',
  'markAllAsRead',
  'deleteNotification',
  'deleteNotifications',
  'markBatchReadStatus',
  'getNotificationStats',
  'getNotificationsOverTime',
]

function getActionSegment(action) {
  const start = notificationsSource.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist in notifications.ts`)
  const next = notificationsSource.indexOf('\nexport ', start + 1)
  return notificationsSource.slice(start, next === -1 ? undefined : next)
}

test('notification actions derive the user scope from the authenticated session', () => {
  for (const action of userScopedActions) {
    const segment = getActionSegment(action)

    assert.doesNotMatch(
      segment,
      /\buserId\s*:/,
      `${action} must not accept a caller-controlled userId`,
    )
    assert.match(
      segment,
      /const authSession = await getRequiredSession\(\)[\s\S]*resolveCurrentActionScope\(authSession\)/,
      `${action} must derive the authenticated session and instance scope before querying notifications`,
    )
    assert.match(
      segment,
      /eq\(notifications\.userId, session\.user\.id\)/,
      `${action} must scope notification access to session.user.id`,
    )
  }
})
