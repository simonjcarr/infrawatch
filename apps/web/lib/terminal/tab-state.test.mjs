import test from 'node:test'
import assert from 'node:assert/strict'

import { clearTerminalPasswordForTab } from './tab-state.ts'

test('clearTerminalPasswordForTab removes the cached password from the ended tab only', () => {
  const tabs = [
    {
      id: 'tab-1',
      binding: {
        hostId: 'host-1',
        hostname: 'alpha.internal',
        username: 'alice',
        password: 'secret-one',
        orgId: 'org-1',
        directAccess: false,
      },
    },
    {
      id: 'tab-2',
      binding: {
        hostId: 'host-2',
        hostname: 'beta.internal',
        username: 'bob',
        password: 'secret-two',
        orgId: 'org-1',
        directAccess: false,
      },
    },
  ]

  const next = clearTerminalPasswordForTab(tabs, 'tab-1')

  assert.equal(next[0]?.binding.password, undefined)
  assert.equal(next[1]?.binding.password, 'secret-two')
  assert.equal(next[0]?.binding.username, 'alice')
  assert.equal(next[1]?.binding.username, 'bob')
})
