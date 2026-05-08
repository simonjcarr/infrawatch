import {
  getCtCveConnectionStatus,
  type CtCveConnectionStatus,
  type CtCveConnectionStatusRepository,
} from './connection-status.ts'
import {
  type CtCveServiceTokenScope,
} from './service-token.ts'
import {
  getCtCveConnectorSettingsSummary,
  type CtCveConnectorSettingsRepository,
  type CtCveConnectorSettingsSummary,
} from './connector-settings.ts'

interface BuildOverviewOptions {
  orgId: string
  settingsRepository?: CtCveConnectorSettingsRepository
  statusRepository?: CtCveConnectionStatusRepository
}

export interface CtCveConnectorSetupOverview {
  configured: boolean
  enabled: boolean
  inbound: {
    configured: boolean
    tokenCount: number
    revokedTokenCount: number
    scopes: CtCveServiceTokenScope[]
    error: string | null
  }
  inventoryPush: {
    configured: boolean
    targetCount: number
    targets: Array<{
      name: string
      baseUrl: string
    }>
    error: string | null
  }
  status: CtCveConnectionStatus
}

function sortedScopes(scopes: Iterable<CtCveServiceTokenScope>): CtCveServiceTokenScope[] {
  return Array.from(new Set(scopes)).sort()
}

function summariseInboundTokens(
  settings: CtCveConnectorSettingsSummary | null,
): CtCveConnectorSetupOverview['inbound'] {
  const configured = Boolean(settings?.enabled && settings.hasCtCveTokenSecret)
  return {
    configured,
    tokenCount: configured ? 1 : 0,
    revokedTokenCount: 0,
    scopes: configured ? sortedScopes(['connection:read', 'findings:write']) : [],
    error: null,
  }
}

function summariseInventoryPushTargets(
  settings: CtCveConnectorSettingsSummary | null,
): CtCveConnectorSetupOverview['inventoryPush'] {
  const configured = Boolean(settings?.enabled && settings.hasInventoryTokenSecret)
  return {
    configured,
    targetCount: configured ? 1 : 0,
    targets: configured ? [{ name: settings!.name, baseUrl: settings!.baseUrl }] : [],
    error: null,
  }
}

export async function buildCtCveConnectorSetupOverview({
  orgId,
  settingsRepository,
  statusRepository,
}: BuildOverviewOptions): Promise<CtCveConnectorSetupOverview> {
  const repository = settingsRepository ?? {
    getSummary: getCtCveConnectorSettingsSummary,
  }
  const settings = await repository.getSummary(orgId)
  const inbound = summariseInboundTokens(settings)
  const inventoryPush = summariseInventoryPushTargets(settings)
  const configured = Boolean(settings)
  const enabled = Boolean(settings?.enabled)
  const storedStatus = await getCtCveConnectionStatus(orgId, {
    configured,
    repository: statusRepository,
  })
  const status = {
    ...storedStatus,
    configured,
    enabled,
  }

  return {
    configured,
    enabled,
    inbound,
    inventoryPush,
    status,
  }
}
