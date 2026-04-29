import test from 'node:test'
import assert from 'node:assert/strict'

import { featuresForTier, hasFeature } from './features.ts'

const coreFeatures = [
  'ssoOidc',
  'auditLog',
  'certExpiryTracker',
  'serviceAccountTracker',
  'reportsExport',
  'reportsScheduled',
  'metricRetentionExtended',
  'scheduledTasks',
  'alertRouting',
  'csrInternalCa',
  'sshKeyInventory',
]

const enterpriseFeatures = [
  'ssoSaml',
  'advancedRbac',
  'whiteLabel',
  'compliancePack',
  'airgapBundlers',
  'haDeployment',
]

test('community tier includes core CT Ops features that used to be Pro gated', () => {
  for (const feature of coreFeatures) {
    assert.equal(hasFeature('community', feature), true, feature)
  }
})

test('community tier does not include enterprise-only features', () => {
  for (const feature of enterpriseFeatures) {
    assert.equal(hasFeature('community', feature), false, feature)
  }
})

test('pro tier is a seat capacity tier and does not add enterprise-only features', () => {
  for (const feature of enterpriseFeatures) {
    assert.equal(hasFeature('pro', feature), false, feature)
  }
})

test('featuresForTier reflects core community access and enterprise restrictions', () => {
  const communityFeatures = featuresForTier('community')
  const proFeatures = featuresForTier('pro')
  const enterpriseTierFeatures = featuresForTier('enterprise')

  for (const feature of coreFeatures) {
    assert.equal(communityFeatures.includes(feature), true, feature)
    assert.equal(proFeatures.includes(feature), true, feature)
    assert.equal(enterpriseTierFeatures.includes(feature), true, feature)
  }

  for (const feature of enterpriseFeatures) {
    assert.equal(communityFeatures.includes(feature), false, feature)
    assert.equal(proFeatures.includes(feature), false, feature)
    assert.equal(enterpriseTierFeatures.includes(feature), true, feature)
  }
})
