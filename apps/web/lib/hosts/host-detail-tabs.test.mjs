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

test('container inventory is available as a top-level host tab', () => {
  const containers = PARENT_TABS.find((tab) => tab.id === 'containers')
  const inventory = PARENT_TABS.find((tab) => tab.id === 'inventory')

  assert.ok(containers)
  assert.equal(containers.defaultTab, 'containers')
  assert.equal(containers.children, null)
  assert.equal(inventory?.children?.includes('containers'), false)
})

test('activity host tools live under the top-level activity host tab', () => {
  const admin = PARENT_TABS.find((tab) => tab.id === 'admin')
  const notes = PARENT_TABS.find((tab) => tab.id === 'notes')

  assert.ok(admin)
  assert.equal(admin.label, 'Activity')
  assert.equal(admin.defaultTab, 'notes')
  assert.deepEqual(admin.children, ['notes', 'calendar'])
  assert.equal(notes, undefined)
})
