'use server'

import { revalidatePath } from 'next/cache'

import { requireOrgAdminAccess } from '@/lib/actions/action-auth'
import {
  defaultCtCveConnectorTokenId,
  saveCtCveConnectorSettings as saveConnectorSettings,
} from '@/lib/integrations/ct-cve/connector-settings'

export type CtCveConnectorSettingsActionResult =
  | { success: true }
  | { error: string }

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

export async function saveOrgCtCveConnectorSettings(
  orgId: string,
  input: unknown,
): Promise<CtCveConnectorSettingsActionResult> {
  try {
    await requireOrgAdminAccess(orgId)
  } catch {
    return { error: 'You do not have permission to update CT-CVE settings' }
  }

  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  try {
    await saveConnectorSettings(orgId, {
      enabled: record.enabled === true,
      name: readString(record, 'name'),
      baseUrl: readString(record, 'baseUrl'),
      inventoryTokenId:
        readString(record, 'inventoryTokenId') || defaultCtCveConnectorTokenId('ctops_inventory', orgId),
      inventoryTokenSecret: readString(record, 'inventoryTokenSecret'),
      ctCveTokenId:
        readString(record, 'ctCveTokenId') || defaultCtCveConnectorTokenId('ctcve_findings', orgId),
      ctCveTokenSecret: readString(record, 'ctCveTokenSecret'),
    })
    revalidatePath('/settings/integrations/ct-cve')
    return { success: true }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Failed to save CT-CVE settings',
    }
  }
}
