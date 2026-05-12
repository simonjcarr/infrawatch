import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function source(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('host and group Ansible task controls are gated by automation availability', () => {
  const hostPage = source('app/(dashboard)/hosts/[id]/page.tsx')
  const hostClient = source('app/(dashboard)/hosts/[id]/host-detail-client.tsx')
  const tasksTab = source('app/(dashboard)/hosts/[id]/tasks-tab.tsx')
  const groupPage = source('app/(dashboard)/hosts/groups/[id]/page.tsx')
  const groupClient = source('app/(dashboard)/hosts/groups/[id]/group-detail-client.tsx')

  assert.match(hostPage, /getAnsibleAutomationAvailability\(\)/)
  assert.match(hostPage, /ansibleAutomationEnabled=\{ansibleAutomation\.enabled\}/)
  assert.match(hostClient, /ansibleAutomationEnabled: boolean/)
  assert.match(hostClient, /<TasksTab[\s\S]*ansibleAutomationEnabled=\{ansibleAutomationEnabled\}/)
  assert.match(tasksTab, /ansibleAutomationEnabled: boolean/)
  assert.match(tasksTab, /const canUseAnsible = canRunTasks && ansibleAutomationEnabled/)
  assert.match(tasksTab, /enabled: canUseAnsible && ansibleOpen/)
  assert.match(tasksTab, /\{canUseAnsible && \([\s\S]*Ansible Ping/)

  assert.match(groupPage, /getAnsibleAutomationAvailability\(\)/)
  assert.match(groupPage, /ansibleAutomationEnabled=\{ansibleAutomation\.enabled\}/)
  assert.match(groupClient, /ansibleAutomationEnabled: boolean/)
  assert.match(groupClient, /const canUseAnsible = canRunTasks && ansibleAutomationEnabled/)
  assert.match(groupClient, /enabled: canUseAnsible && ansibleOpen/)
  assert.match(groupClient, /\{canUseAnsible && \([\s\S]*Ansible Ping/)
})

test('automation settings hide Ansible credential management while disabled', () => {
  const settingsClient = source('app/(dashboard)/settings/integrations/automation/automation-settings-client.tsx')

  assert.match(settingsClient, /const enabled = settings\.ansibleFeatureEnabled && settings\.provider === 'ansible'/)
  assert.match(settingsClient, /\{enabled && \([\s\S]*Ansible SSH credentials/)
})
