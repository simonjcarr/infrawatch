import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const here = path.dirname(new URL(import.meta.url).pathname)
const source = readFileSync(path.join(here, '..', '..', 'components', 'shared', 'notification-bell.tsx'), 'utf8')

test('notification bell awaits mark-as-read before navigating to a resource', () => {
  assert.match(
    source,
    /async function handleNotificationSelect\([^)]*Notification[^)]*\)[\s\S]*await markReadMutation\.mutateAsync\(notification\.id\)[\s\S]*navigateTo\(getResourceUrl\(notification\.resourceType, notification\.resourceId\)\)/,
    'notification selection must wait for markAsRead to finish before changing location',
  )
})
