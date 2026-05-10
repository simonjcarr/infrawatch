import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const here = path.dirname(new URL(import.meta.url).pathname)
const source = readFileSync(path.join(here, '..', '..', 'app', '(dashboard)', 'notifications', 'notifications-client.tsx'), 'utf8')

test('notification inbox waits for bulk delete refetches before clearing selection', () => {
  assert.match(
    source,
    /const bulkDeleteMutation = useMutation\(\{[\s\S]*onSuccess: async \(\) => \{[\s\S]*await Promise\.all\(\[[\s\S]*queryKey: \['notifications'\][\s\S]*queryKey: \['notifications-unread'\][\s\S]*queryKey: \['notifications-stats'\][\s\S]*queryKey: \['notifications-time-series'\][\s\S]*\]\)[\s\S]*setSelectedIds\(new Set\(\)\)/,
    'bulk delete must wait for notification list/count/chart refetches before clearing selected state',
  )
})
