'use server'

import { revalidatePath } from 'next/cache'

import { getRequiredSession } from '@/lib/auth/session'
import { requireInstanceAdminAccess } from '@/lib/actions/action-auth'
import { resolveCurrentActionScope } from './action-scope'
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

export async function saveCtCveConnectorSettings(
  input: unknown,
): Promise<CtCveConnectorSettingsActionResult> {
  const session = await getRequiredSession()
  const scopeId = resolveCurrentActionScope(session)
  try {
    await requireInstanceAdminAccess(scopeId)
  } catch {
    return { error: 'You do not have permission to update CT-CVE settings' }
  }

  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  try {
    await saveConnectorSettings(scopeId, {
      enabled: record.enabled === true,
      name: readString(record, 'name'),
      baseUrl: readString(record, 'baseUrl'),
      inventoryTokenId:
        readString(record, 'inventoryTokenId') || defaultCtCveConnectorTokenId('ctops_inventory', scopeId),
      inventoryTokenSecret: readString(record, 'inventoryTokenSecret'),
      ctCveTokenId:
        readString(record, 'ctCveTokenId') || defaultCtCveConnectorTokenId('ctcve_findings', scopeId),
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
