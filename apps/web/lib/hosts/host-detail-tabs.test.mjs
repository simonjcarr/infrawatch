import test from 'node:test'
import assert from 'node:assert/strict'

import { PARENT_TABS } from './host-detail-tabs.ts'

test('host network membership tab belongs under infrastructure', () => {
  const infrastructure = PARENT_TABS.find((tab) => tab.id === 'infrastructure')
  const management = PARENT_TABS.find((tab) => tab.id === 'management')

  assert.ok(infrastructure)
  assert.ok(management)
  assert.ok(infrastructure.children?.includes('host-networks'))
  assert.equal(management.children?.includes('host-networks'), false)
})
