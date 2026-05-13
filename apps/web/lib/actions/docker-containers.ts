'use server'

import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { requireInstanceAccess } from '@/lib/actions/action-auth'
import { db } from '@/lib/db'
import { dockerContainers, hosts, type DockerContainer } from '@/lib/db/schema'
import { escapeLikePattern } from '@/lib/utils'

export interface HostDockerContainerFilters {
  search?: string
  state?: string
  image?: string
}

export interface HostDockerContainersResult {
  containers: DockerContainer[]
  imageOptions: string[]
}

const MAX_CONTAINER_ROWS = 200
const MAX_FILTER_LENGTH = 256
const MAX_METRIC_POINTS = 300

export type DockerContainerMetricsPreset = '1h' | '6h' | '24h' | '7d'

export interface DockerContainerMetricsQuery {
  range?: DockerContainerMetricsPreset
}

export interface DockerContainerMetricPoint {
  recordedAt: Date
  cpuAvg: number | null
  cpuMax: number | null
  memoryAvg: number | null
  memoryMax: number | null
  memoryUsageAvg: number | null
  memoryUsageMax: number | null
  networkRxAvg: number | null
  networkRxMax: number | null
  networkTxAvg: number | null
  networkTxMax: number | null
  blockReadAvg: number | null
  blockReadMax: number | null
  blockWriteAvg: number | null
  blockWriteMax: number | null
  pidsAvg: number | null
  pidsMax: number | null
}

export interface HostDockerContainerMetricsResult {
  container: DockerContainer | null
  points: DockerContainerMetricPoint[]
}

function cleanFilter(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === 'all') return undefined
  return trimmed.slice(0, MAX_FILTER_LENGTH)
}

function resolveMetricRange(range: DockerContainerMetricsPreset | undefined): { from: Date; to: Date; bucketInterval: string } {
  const hours: Record<DockerContainerMetricsPreset, number> = {
    '1h': 1,
    '6h': 6,
    '24h': 24,
    '7d': 168,
  }
  const bucketIntervals: Record<DockerContainerMetricsPreset, string> = {
    '1h': '1 minute',
    '6h': '2 minutes',
    '24h': '10 minutes',
    '7d': '1 hour',
  }
  const selected = range && range in hours ? range : '1h'
  const to = new Date()
  const from = new Date(to.getTime() - hours[selected] * 3_600_000)
  return { from, to, bucketInterval: bucketIntervals[selected] }
}

export async function getHostDockerContainers(
  instanceId: string,
  hostId: string,
  filters: HostDockerContainerFilters = {},
): Promise<HostDockerContainersResult> {
  await requireInstanceAccess(instanceId)

  const host = await db.query.hosts.findFirst({
    columns: { id: true },
    where: and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)),
  })
  if (!host) return { containers: [], imageOptions: [] }

  const search = cleanFilter(filters.search)
  const state = cleanFilter(filters.state)
  const image = cleanFilter(filters.image)

  const conditions = [
    eq(dockerContainers.instanceId, instanceId),
    eq(dockerContainers.hostId, hostId),
  ]

  if (state) {
    conditions.push(eq(dockerContainers.state, state))
  }
  if (image) {
    conditions.push(eq(dockerContainers.image, image))
  }
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`
    const searchClause = or(
      ilike(dockerContainers.primaryName, pattern),
      ilike(dockerContainers.image, pattern),
      ilike(dockerContainers.dockerContainerId, pattern),
      sql`${dockerContainers.namesJson}::text ILIKE ${pattern}`,
    )
    if (searchClause) conditions.push(searchClause)
  }

  const [rows, images] = await Promise.all([
    db.query.dockerContainers.findMany({
      where: and(...conditions),
      orderBy: [
        desc(dockerContainers.isPresent),
        desc(dockerContainers.lastSeenAt),
        asc(dockerContainers.primaryName),
      ],
      limit: MAX_CONTAINER_ROWS,
    }),
    db.query.dockerContainers.findMany({
      columns: { image: true },
      where: and(eq(dockerContainers.instanceId, instanceId), eq(dockerContainers.hostId, hostId)),
      orderBy: [asc(dockerContainers.image)],
    }),
  ])

  return {
    containers: rows,
    imageOptions: Array.from(new Set(images
      .map((row) => row.image)
      .filter((value): value is string => Boolean(value)))),
  }
}

export async function getHostDockerContainerMetrics(
  instanceId: string,
  hostId: string,
  dockerContainerId: string,
  query: DockerContainerMetricsQuery = {},
): Promise<HostDockerContainerMetricsResult> {
  await requireInstanceAccess(instanceId)

  const host = await db.query.hosts.findFirst({
    columns: { id: true },
    where: and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)),
  })
  if (!host) return { container: null, points: [] }

  const container = await db.query.dockerContainers.findFirst({
    where: and(
      eq(dockerContainers.instanceId, instanceId),
      eq(dockerContainers.hostId, hostId),
      eq(dockerContainers.dockerContainerId, dockerContainerId),
    ),
  })
  if (!container) return { container: null, points: [] }

  const range = resolveMetricRange(query.range)
  const bucket = sql.raw(`time_bucket('${range.bucketInterval}'::interval, recorded_at)`)
  const rows = await db.execute<{
    recorded_at: Date
    cpu_avg: number | null
    cpu_max: number | null
    memory_avg: number | null
    memory_max: number | null
    memory_usage_avg: number | null
    memory_usage_max: number | null
    network_rx_avg: number | null
    network_rx_max: number | null
    network_tx_avg: number | null
    network_tx_max: number | null
    block_read_avg: number | null
    block_read_max: number | null
    block_write_avg: number | null
    block_write_max: number | null
    pids_avg: number | null
    pids_max: number | null
  }>(sql`
    SELECT
      ${bucket}                         AS recorded_at,
      AVG(cpu_percent)::double precision AS cpu_avg,
      MAX(cpu_percent)::double precision AS cpu_max,
      AVG(memory_percent)::double precision AS memory_avg,
      MAX(memory_percent)::double precision AS memory_max,
      AVG(memory_usage_bytes)::double precision AS memory_usage_avg,
      MAX(memory_usage_bytes)::double precision AS memory_usage_max,
      AVG(network_rx_bytes)::double precision AS network_rx_avg,
      MAX(network_rx_bytes)::double precision AS network_rx_max,
      AVG(network_tx_bytes)::double precision AS network_tx_avg,
      MAX(network_tx_bytes)::double precision AS network_tx_max,
      AVG(block_read_bytes)::double precision AS block_read_avg,
      MAX(block_read_bytes)::double precision AS block_read_max,
      AVG(block_write_bytes)::double precision AS block_write_avg,
      MAX(block_write_bytes)::double precision AS block_write_max,
      AVG(pids_current)::double precision AS pids_avg,
      MAX(pids_current)::double precision AS pids_max
    FROM docker_container_metrics
    WHERE instance_id = ${instanceId}
      AND host_id = ${hostId}
      AND docker_container_row_id = ${container.id}
      AND docker_container_id = ${dockerContainerId}
      AND recorded_at >= ${range.from.toISOString()}
      AND recorded_at <= ${range.to.toISOString()}
    GROUP BY ${bucket}
    ORDER BY 1 ASC
    LIMIT ${MAX_METRIC_POINTS}
  `)

  return {
    container,
    points: Array.from(rows).map((row) => ({
      recordedAt: new Date(row.recorded_at),
      cpuAvg: row.cpu_avg,
      cpuMax: row.cpu_max,
      memoryAvg: row.memory_avg,
      memoryMax: row.memory_max,
      memoryUsageAvg: row.memory_usage_avg,
      memoryUsageMax: row.memory_usage_max,
      networkRxAvg: row.network_rx_avg,
      networkRxMax: row.network_rx_max,
      networkTxAvg: row.network_tx_avg,
      networkTxMax: row.network_tx_max,
      blockReadAvg: row.block_read_avg,
      blockReadMax: row.block_read_max,
      blockWriteAvg: row.block_write_avg,
      blockWriteMax: row.block_write_max,
      pidsAvg: row.pids_avg,
      pidsMax: row.pids_max,
    })),
  }
}
