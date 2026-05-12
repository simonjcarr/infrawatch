import {
  isAdminConfigurableFeatureFlag,
  resolveFeatureFlag,
  type FeatureFlagOverrides,
} from '../feature-flags.ts'
import type { InstanceAutomationSettings } from '../db/schema/instance-settings.ts'

export type AutomationProvider = InstanceAutomationSettings['provider']
export type AutomationStatus = 'disabled' | 'healthy' | 'unavailable'

export interface AutomationSettingsSnapshot {
  provider: AutomationProvider
  ansibleFeatureEnabled: boolean
  ansibleAdminConfigurable: boolean
}

export function getStoredAutomationProvider(settings?: InstanceAutomationSettings): AutomationProvider {
  return settings?.provider === 'ansible' ? 'ansible' : 'none'
}

export function buildAutomationSettingsSnapshot(input: {
  featureFlags?: FeatureFlagOverrides
  automationSettings?: InstanceAutomationSettings
}): AutomationSettingsSnapshot {
  return {
    provider: getStoredAutomationProvider(input.automationSettings),
    ansibleFeatureEnabled: resolveFeatureFlag('automation.ansible', input.featureFlags),
    ansibleAdminConfigurable: isAdminConfigurableFeatureFlag('automation.ansible'),
  }
}

export function isAnsibleAutomationEnabled(snapshot: AutomationSettingsSnapshot): boolean {
  return snapshot.ansibleFeatureEnabled && snapshot.provider === 'ansible'
}

export function nextAutomationMetadata(input: {
  featureFlags?: FeatureFlagOverrides
  enableAnsible: boolean
}): {
  featureFlags: FeatureFlagOverrides
  automationSettings: InstanceAutomationSettings
} {
  if (!isAdminConfigurableFeatureFlag('automation.ansible')) {
    throw new Error('Ansible automation is not admin-configurable')
  }

  return {
    featureFlags: {
      ...(input.featureFlags ?? {}),
      'automation.ansible': input.enableAnsible,
    },
    automationSettings: {
      provider: input.enableAnsible ? 'ansible' : 'none',
    },
  }
}
