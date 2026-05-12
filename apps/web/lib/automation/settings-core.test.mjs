import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAutomationSettingsSnapshot,
  getStoredAutomationProvider,
  isAnsibleAutomationEnabled,
  nextAutomationMetadata,
} from './settings-core.ts'

test('missing automation metadata is disabled by default', () => {
  assert.deepEqual(buildAutomationSettingsSnapshot({}), {
    provider: 'none',
    ansibleFeatureEnabled: false,
    ansibleAdminConfigurable: true,
  })
})

test('valid ansible metadata enables the provider snapshot', () => {
  assert.deepEqual(buildAutomationSettingsSnapshot({
    featureFlags: { 'automation.ansible': true },
    automationSettings: { provider: 'ansible' },
  }), {
    provider: 'ansible',
    ansibleFeatureEnabled: true,
    ansibleAdminConfigurable: true,
  })
})

test('getStoredAutomationProvider rejects malformed providers', () => {
  assert.equal(getStoredAutomationProvider({ provider: 'bad' }), 'none')
})

test('isAnsibleAutomationEnabled requires both the flag and provider', () => {
  assert.equal(isAnsibleAutomationEnabled({
    provider: 'ansible',
    ansibleFeatureEnabled: true,
    ansibleAdminConfigurable: true,
  }), true)
  assert.equal(isAnsibleAutomationEnabled({
    provider: 'ansible',
    ansibleFeatureEnabled: false,
    ansibleAdminConfigurable: true,
  }), false)
  assert.equal(isAnsibleAutomationEnabled({
    provider: 'none',
    ansibleFeatureEnabled: true,
    ansibleAdminConfigurable: true,
  }), false)
})

test('nextAutomationMetadata writes explicit feature flag and provider choices', () => {
  assert.deepEqual(nextAutomationMetadata({
    featureFlags: {},
    enableAnsible: true,
  }), {
    featureFlags: { 'automation.ansible': true },
    automationSettings: { provider: 'ansible' },
  })

  assert.deepEqual(nextAutomationMetadata({
    featureFlags: { 'automation.ansible': true },
    enableAnsible: false,
  }), {
    featureFlags: { 'automation.ansible': false },
    automationSettings: { provider: 'none' },
  })
})
