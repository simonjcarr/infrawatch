import {
  getCtCveConnectionStatus,
  type CtCveConnectionStatus,
  type CtCveConnectionStatusRepository,
} from './connection-status.ts'
import { parseCtCveInventoryPushTargets } from './inventory-push-job.ts'
import {
  parseCtCveServiceTokens,
  type CtCveServiceTokenScope,
} from './service-token.ts'

interface BuildOverviewOptions {
  orgId: string
  env?: NodeJS.ProcessEnv
  statusRepository?: CtCveConnectionStatusRepository
}

export interface CtCveConnectorSetupOverview {
  configured: boolean
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sortedScopes(scopes: Iterable<CtCveServiceTokenScope>): CtCveServiceTokenScope[] {
  return Array.from(new Set(scopes)).sort()
}

function summariseInboundTokens(orgId: string, env: NodeJS.ProcessEnv): CtCveConnectorSetupOverview['inbound'] {
  try {
    const tokens = parseCtCveServiceTokens(env.CT_CVE_SERVICE_TOKENS)
      .filter((token) => token.orgId === orgId)
    const activeTokens = tokens.filter((token) => !token.revoked)

    return {
      configured: activeTokens.length > 0,
      tokenCount: activeTokens.length,
      revokedTokenCount: tokens.length - activeTokens.length,
      scopes: sortedScopes(activeTokens.flatMap((token) => token.scopes)),
      error: null,
    }
  } catch (error) {
    return {
      configured: false,
      tokenCount: 0,
      revokedTokenCount: 0,
      scopes: [],
      error: `CT_CVE_SERVICE_TOKENS: ${errorMessage(error)}`,
    }
  }
}

function summariseInventoryPushTargets(
  orgId: string,
  env: NodeJS.ProcessEnv,
): CtCveConnectorSetupOverview['inventoryPush'] {
  try {
    const targets = parseCtCveInventoryPushTargets(env.CT_CVE_INVENTORY_PUSH_TARGETS)
      .filter((target) => target.token.orgId === orgId)
      .map((target) => ({
        name: target.name,
        baseUrl: target.baseUrl,
      }))

    return {
      configured: targets.length > 0,
      targetCount: targets.length,
      targets,
      error: null,
    }
  } catch (error) {
    return {
      configured: false,
      targetCount: 0,
      targets: [],
      error: `CT_CVE_INVENTORY_PUSH_TARGETS: ${errorMessage(error)}`,
    }
  }
}

export async function buildCtCveConnectorSetupOverview({
  orgId,
  env = process.env,
  statusRepository,
}: BuildOverviewOptions): Promise<CtCveConnectorSetupOverview> {
  const inbound = summariseInboundTokens(orgId, env)
  const inventoryPush = summariseInventoryPushTargets(orgId, env)
  const configured = inbound.configured || inventoryPush.configured
  const status = await getCtCveConnectionStatus(orgId, {
    configured,
    repository: statusRepository,
  })

  return {
    configured,
    inbound,
    inventoryPush,
    status,
  }
}
