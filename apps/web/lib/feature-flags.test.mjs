import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FEATURE_FLAG_REGISTRY,
  normaliseFeatureFlagOverrides,
  resolveFeatureFlag,
  serialisePublicFeatureFlags,
} from './feature-flags.ts'

test('automation.ansible is a known public admin-configurable flag defaulting off', () => {
  assert.equal(FEATURE_FLAG_REGISTRY['automation.ansible'].defaultEnabled, false)
  assert.equal(FEATURE_FLAG_REGISTRY['automation.ansible'].public, true)
  assert.equal(FEATURE_FLAG_REGISTRY['automation.ansible'].adminConfigurable, true)
})

test('missing and unknown feature flag overrides fail closed', () => {
  assert.equal(resolveFeatureFlag('automation.ansible', undefined), false)
  assert.equal(resolveFeatureFlag('unknown.flag', { 'unknown.flag': true }), false)
})

test('database overrides enable and disable known feature flags', () => {
  assert.equal(resolveFeatureFlag('automation.ansible', { 'automation.ansible': true }), true)
  assert.equal(resolveFeatureFlag('automation.ansible', { 'automation.ansible': false }), false)
})

test('normaliseFeatureFlagOverrides keeps only known boolean flags', () => {
  assert.deepEqual(normaliseFeatureFlagOverrides({
    'automation.ansible': true,
    'unknown.flag': true,
    malformed: 'yes',
  }), {
    'automation.ansible': true,
  })
})

test('serialisePublicFeatureFlags exposes only public-safe flag data', () => {
  assert.deepEqual(serialisePublicFeatureFlags({ 'automation.ansible': true }), {
    'automation.ansible': {
      enabled: true,
      adminConfigurable: true,
      description: FEATURE_FLAG_REGISTRY['automation.ansible'].description,
    },
  })
})
