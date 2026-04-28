export interface AgentVersionRow {
  version: string | null
}

export interface AgentUpgradeSummary {
  requiredVersion: string
  notUpgraded: number
  unknownVersion: number
}

export interface IngestSnapshotSummaryRow {
  serverId: string
  observedAt: Date
  activeRequests: number
  messagesReceivedTotal: number
  heapAllocBytes: number
  heapSysBytes: number
  goroutines: number
  dbOpenConnections: number
}

export interface IngestHistorySummaryRow {
  serverId: string
  observedAt: Date
  messagesReceivedTotal: number
}

export interface IngestHealthSummary {
  totalServers: number
  onlineServers: number
  messagesProcessing: number
  messagesReceivedLastHour: number
  heapAllocBytes: number
  heapSysBytes: number
  goroutines: number
  dbOpenConnections: number
}

const INGEST_ONLINE_WINDOW_MS = 2 * 60 * 1000

function normaliseVersion(version: string | null | undefined): string | null {
  const v = version?.trim()
  return v ? v : null
}

export function calculateAgentUpgradeSummary(
  agents: AgentVersionRow[],
  requiredVersion: string,
): AgentUpgradeSummary {
  const required = normaliseVersion(requiredVersion) ?? requiredVersion
  let notUpgraded = 0
  let unknownVersion = 0

  for (const agent of agents) {
    const version = normaliseVersion(agent.version)
    if (version == null) {
      unknownVersion += 1
      notUpgraded += 1
      continue
    }
    if (version === 'dev') continue
    if (version !== required) notUpgraded += 1
  }

  return {
    requiredVersion: required,
    notUpgraded,
    unknownVersion,
  }
}

export function calculateIngestHealthSummary(
  latestSnapshots: IngestSnapshotSummaryRow[],
  history: IngestHistorySummaryRow[],
  now = new Date(),
): IngestHealthSummary {
  const onlineCutoff = now.getTime() - INGEST_ONLINE_WINDOW_MS
  const byServer = new Map<string, IngestHistorySummaryRow[]>()

  for (const row of history) {
    const rows = byServer.get(row.serverId) ?? []
    rows.push(row)
    byServer.set(row.serverId, rows)
  }

  let messagesReceivedLastHour = 0
  for (const rows of byServer.values()) {
    rows.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())
    const first = rows[0]
    const last = rows[rows.length - 1]
    if (!first || !last) continue
    messagesReceivedLastHour += Math.max(0, last.messagesReceivedTotal - first.messagesReceivedTotal)
  }

  return latestSnapshots.reduce<IngestHealthSummary>((summary, row) => {
    summary.totalServers += 1
    if (row.observedAt.getTime() >= onlineCutoff) summary.onlineServers += 1
    summary.messagesProcessing += Number(row.activeRequests ?? 0)
    summary.heapAllocBytes += Number(row.heapAllocBytes ?? 0)
    summary.heapSysBytes += Number(row.heapSysBytes ?? 0)
    summary.goroutines += Number(row.goroutines ?? 0)
    summary.dbOpenConnections += Number(row.dbOpenConnections ?? 0)
    return summary
  }, {
    totalServers: 0,
    onlineServers: 0,
    messagesProcessing: 0,
    messagesReceivedLastHour,
    heapAllocBytes: 0,
    heapSysBytes: 0,
    goroutines: 0,
    dbOpenConnections: 0,
  })
}
