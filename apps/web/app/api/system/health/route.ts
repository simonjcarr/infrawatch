import { db } from '@/lib/db'
import { agents, hosts, organisations } from '@/lib/db/schema'
import { eq, and, isNull, count, inArray, sql } from 'drizzle-orm'
import { REQUIRED_AGENT_VERSION } from '@/lib/agent/version'
import {
  calculateAgentUpgradeSummary,
  calculateIngestHealthSummary,
  type IngestHistorySummaryRow,
  type IngestSnapshotSummaryRow,
} from '@/lib/system/health'
import pkg from '../../../../package.json'
import { ApiAuthError, getApiOrgAdminSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  let session
  try {
    session = await getApiOrgAdminSession()
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    throw err
  }

  const orgId = session.user.organisationId

  const [agentRows, org, agentVersionRows, ingestLatestRows, ingestHistoryRows, agentErrorRows] = await Promise.all([
    db
      .select({ status: agents.status, count: count() })
      .from(agents)
      .innerJoin(hosts, and(eq(hosts.agentId, agents.id), isNull(hosts.deletedAt)))
      .where(and(eq(agents.organisationId, orgId), isNull(agents.deletedAt)))
      .groupBy(agents.status),

    db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
    }),

    db.query.agents.findMany({
      columns: { version: true },
      where: and(
        eq(agents.organisationId, orgId),
        isNull(agents.deletedAt),
        inArray(agents.status, ['active', 'offline']),
      ),
    }),

    db.execute<{
      server_id: string
      hostname: string
      process_id: number
      version: string | null
      started_at: Date
      observed_at: Date
      active_requests: number
      messages_received_total: number
      queue_depth: number
      queue_capacity: number
      goroutines: number
      heap_alloc_bytes: number
      heap_sys_bytes: number
      db_open_connections: number
      db_acquired_connections: number
    }>(sql`
      SELECT DISTINCT ON (server_id)
        server_id,
        hostname,
        process_id,
        version,
        started_at,
        observed_at,
        active_requests,
        messages_received_total,
        queue_depth,
        queue_capacity,
        goroutines,
        heap_alloc_bytes,
        heap_sys_bytes,
        db_open_connections,
        db_acquired_connections
      FROM ingest_server_snapshots
      WHERE observed_at >= NOW() - INTERVAL '24 hours'
      ORDER BY server_id, observed_at DESC
    `),

    db.execute<{
      server_id: string
      observed_at: Date
      messages_received_total: number
    }>(sql`
      SELECT server_id, observed_at, messages_received_total
      FROM ingest_server_snapshots
      WHERE observed_at >= NOW() - INTERVAL '1 hour'
      ORDER BY server_id, observed_at ASC
    `),

    db.execute<{
      agent_id: string | null
      hostname: string
      source: string
      message: string
      occurred_at: Date
    }>(sql`
      SELECT * FROM (
        SELECT
          a.id AS agent_id,
          COALESCE(h.hostname, a.hostname, 'Unknown host') AS hostname,
          'Certificate signing' AS source,
          pcs.last_error AS message,
          COALESCE(pcs.last_attempt_at, pcs.requested_at) AS occurred_at
        FROM pending_cert_signings pcs
        INNER JOIN agents a ON a.id = pcs.agent_id
        LEFT JOIN hosts h ON h.agent_id = a.id AND h.deleted_at IS NULL
        WHERE a.organisation_id = ${orgId}
          AND a.deleted_at IS NULL
          AND pcs.last_error IS NOT NULL

        UNION ALL

        SELECT
          a.id AS agent_id,
          h.hostname AS hostname,
          'Agent query' AS source,
          aq.error AS message,
          COALESCE(aq.completed_at, aq.updated_at, aq.requested_at) AS occurred_at
        FROM agent_queries aq
        INNER JOIN hosts h ON h.id = aq.host_id
        LEFT JOIN agents a ON a.id = h.agent_id
        WHERE aq.organisation_id = ${orgId}
          AND aq.status = 'error'
          AND aq.error IS NOT NULL
          AND aq.deleted_at IS NULL
          AND h.deleted_at IS NULL

        UNION ALL

        SELECT
          a.id AS agent_id,
          h.hostname AS hostname,
          'Software inventory' AS source,
          ss.error_message AS message,
          COALESCE(ss.completed_at, ss.created_at) AS occurred_at
        FROM software_scans ss
        INNER JOIN hosts h ON h.id = ss.host_id
        LEFT JOIN agents a ON a.id = h.agent_id
        WHERE ss.organisation_id = ${orgId}
          AND ss.status = 'failed'
          AND ss.error_message IS NOT NULL
          AND h.deleted_at IS NULL

        UNION ALL

        SELECT
          a.id AS agent_id,
          h.hostname AS hostname,
          'Task run' AS source,
          COALESCE(NULLIF(left(trh.raw_output, 500), ''), trh.skip_reason, 'Task failed') AS message,
          COALESCE(trh.completed_at, trh.updated_at, trh.created_at) AS occurred_at
        FROM task_run_hosts trh
        INNER JOIN hosts h ON h.id = trh.host_id
        INNER JOIN task_runs tr ON tr.id = trh.task_run_id
        LEFT JOIN agents a ON a.id = h.agent_id
        WHERE trh.organisation_id = ${orgId}
          AND trh.status = 'failed'
          AND trh.deleted_at IS NULL
          AND tr.deleted_at IS NULL
          AND h.deleted_at IS NULL
      ) errors
      ORDER BY occurred_at DESC
      LIMIT 50
    `),
  ])

  const agentMap = Object.fromEntries(agentRows.map((r) => [r.status, r.count]))
  const agentOnline = agentMap['active'] ?? 0
  const agentOffline = agentMap['offline'] ?? 0
  const agentTotal = Object.values(agentMap).reduce((sum, n) => sum + n, 0)

  const latestSnapshots = Array.from(ingestLatestRows).map((row): IngestSnapshotSummaryRow => ({
    serverId: row.server_id,
    observedAt: new Date(row.observed_at),
    activeRequests: Number(row.active_requests ?? 0),
    messagesReceivedTotal: Number(row.messages_received_total ?? 0),
    heapAllocBytes: Number(row.heap_alloc_bytes ?? 0),
    heapSysBytes: Number(row.heap_sys_bytes ?? 0),
    goroutines: Number(row.goroutines ?? 0),
    dbOpenConnections: Number(row.db_open_connections ?? 0),
  }))
  const history = Array.from(ingestHistoryRows).map((row): IngestHistorySummaryRow => ({
    serverId: row.server_id,
    observedAt: new Date(row.observed_at),
    messagesReceivedTotal: Number(row.messages_received_total ?? 0),
  }))
  const ingestSummary = calculateIngestHealthSummary(latestSnapshots, history)
  const agentUpgradeSummary = calculateAgentUpgradeSummary(agentVersionRows, REQUIRED_AGENT_VERSION)

  return Response.json({
    version: pkg.version,
    licenceTier: org?.licenceTier ?? 'community',
    metricRetentionDays: org?.metricRetentionDays ?? 30,
    database: { connected: true },
    agents: {
      online: agentOnline,
      offline: agentOffline,
      total: agentTotal,
      upgrades: agentUpgradeSummary,
      errors: Array.from(agentErrorRows).map((row) => ({
        agentId: row.agent_id,
        hostname: row.hostname,
        source: row.source,
        message: row.message,
        occurredAt: new Date(row.occurred_at).toISOString(),
      })),
    },
    ingest: {
      ...ingestSummary,
      servers: Array.from(ingestLatestRows).map((row) => ({
        serverId: row.server_id,
        hostname: row.hostname,
        processId: Number(row.process_id),
        version: row.version,
        startedAt: new Date(row.started_at).toISOString(),
        observedAt: new Date(row.observed_at).toISOString(),
        activeRequests: Number(row.active_requests ?? 0),
        messagesReceivedTotal: Number(row.messages_received_total ?? 0),
        queueDepth: Number(row.queue_depth ?? 0),
        queueCapacity: Number(row.queue_capacity ?? 0),
        goroutines: Number(row.goroutines ?? 0),
        heapAllocBytes: Number(row.heap_alloc_bytes ?? 0),
        heapSysBytes: Number(row.heap_sys_bytes ?? 0),
        dbOpenConnections: Number(row.db_open_connections ?? 0),
        dbAcquiredConnections: Number(row.db_acquired_connections ?? 0),
      })),
    },
  })
}
