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
const MAX_LIFECYCLE_EVENTS = 100

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

export type DockerTopContainerMetric = 'cpu' | 'memory' | 'network' | 'block'
export type DockerTopContainerStatistic = 'max' | 'p95'

export interface DockerTopContainersQuery {
  range?: DockerContainerMetricsPreset
  metric?: DockerTopContainerMetric
  statistic?: DockerTopContainerStatistic
}

export interface DockerTopContainerRow {
  dockerContainerId: string
  primaryName: string | null
  image: string | null
  state: string | null
  isPresent: boolean
  lastSeenAt: Date | null
  value: number | null
  sampleCount: number
}

export interface HostDockerTopContainersResult {
  containers: DockerTopContainerRow[]
}

export type DockerContainerLifecycleEventType = 'started' | 'stopped' | 'restarted' | 'disappeared'

export interface DockerContainerLifecycleEventRow {
  id: string
  dockerContainerId: string
  primaryName: string | null
  image: string | null
  state: string | null
  status: string | null
  eventType: DockerContainerLifecycleEventType
  occurredAt: Date
  restartCount: number | null
}

export interface HostDockerContainerLifecycleEventsResult {
  events: DockerContainerLifecycleEventRow[]
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

function resolveTopMetric(metric: DockerTopContainerMetric | undefined): DockerTopContainerMetric {
  return metric === 'memory' || metric === 'network' || metric === 'block' ? metric : 'cpu'
}

function resolveTopStatistic(statistic: DockerTopContainerStatistic | undefined): DockerTopContainerStatistic {
  return statistic === 'p95' ? 'p95' : 'max'
}

function topMetricExpression(metric: DockerTopContainerMetric): string {
  switch (metric) {
    case 'memory':
      return 'm.memory_percent'
    case 'network':
      return `CASE
        WHEN m.network_rx_bytes IS NULL AND m.network_tx_bytes IS NULL THEN NULL
        ELSE COALESCE(m.network_rx_bytes, 0) + COALESCE(m.network_tx_bytes, 0)
      END`
    case 'block':
      return `CASE
        WHEN m.block_read_bytes IS NULL AND m.block_write_bytes IS NULL THEN NULL
        ELSE COALESCE(m.block_read_bytes, 0) + COALESCE(m.block_write_bytes, 0)
      END`
    case 'cpu':
    default:
      return 'm.cpu_percent'
  }
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

export async function getHostDockerTopContainers(
  instanceId: string,
  hostId: string,
  query: DockerTopContainersQuery = {},
): Promise<HostDockerTopContainersResult> {
  await requireInstanceAccess(instanceId)

  const host = await db.query.hosts.findFirst({
    columns: { id: true },
    where: and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)),
  })
  if (!host) return { containers: [] }

  const range = resolveMetricRange(query.range)
  const metric = resolveTopMetric(query.metric)
  const statistic = resolveTopStatistic(query.statistic)
  const metricSql = topMetricExpression(metric)
  const aggregateSql = statistic === 'p95'
    ? `(percentile_cont(0.95) WITHIN GROUP (ORDER BY metric_value))::double precision`
    : `MAX(metric_value)::double precision`

  const rows = await db.execute<{
    docker_container_id: string
    primary_name: string | null
    image: string | null
    state: string | null
    is_present: boolean
    last_seen_at: Date | null
    value: number | null
    sample_count: number
  }>(sql`
    WITH metric_values AS (
      SELECT
        dc.docker_container_id,
        dc.primary_name,
        dc.image,
        dc.state,
        dc.is_present,
        dc.last_seen_at,
        ${sql.raw(metricSql)}::double precision AS metric_value
      FROM docker_container_metrics m
      INNER JOIN docker_containers dc
        ON dc.id = m.docker_container_row_id
       AND dc.instance_id = m.instance_id
       AND dc.host_id = m.host_id
       AND dc.docker_container_id = m.docker_container_id
      WHERE m.instance_id = ${instanceId}
        AND m.host_id = ${hostId}
        AND m.recorded_at >= ${range.from.toISOString()}
        AND m.recorded_at <= ${range.to.toISOString()}
    )
    SELECT
      docker_container_id,
      primary_name,
      image,
      state,
      is_present,
      last_seen_at,
      ${sql.raw(aggregateSql)} AS value,
      COUNT(metric_value)::integer AS sample_count
    FROM metric_values
    WHERE metric_value IS NOT NULL
    GROUP BY docker_container_id, primary_name, image, state, is_present, last_seen_at
    ORDER BY value DESC NULLS LAST, primary_name ASC NULLS LAST, docker_container_id ASC
    LIMIT 10
  `)

  return {
    containers: Array.from(rows).map((row) => ({
      dockerContainerId: row.docker_container_id,
      primaryName: row.primary_name,
      image: row.image,
      state: row.state,
      isPresent: row.is_present,
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
      value: row.value,
      sampleCount: row.sample_count,
    })),
  }
}

export async function getHostDockerContainerLifecycleEvents(
  instanceId: string,
  hostId: string,
): Promise<HostDockerContainerLifecycleEventsResult> {
  await requireInstanceAccess(instanceId)

  const host = await db.query.hosts.findFirst({
    columns: { id: true },
    where: and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)),
  })
  if (!host) return { events: [] }

  const rows = await db.execute<{
    id: string
    docker_container_id: string
    primary_name: string | null
    image: string | null
    state: string | null
    status: string | null
    event_type: DockerContainerLifecycleEventType
    occurred_at: Date
    restart_count: number | null
  }>(sql`
    SELECT
      e.id,
      e.docker_container_id,
      COALESCE(dc.primary_name, e.primary_name) AS primary_name,
      COALESCE(dc.image, e.image) AS image,
      CASE WHEN dc.is_present = true THEN dc.state ELSE e.state END AS state,
      CASE WHEN dc.is_present = true THEN dc.status ELSE e.status END AS status,
      e.event_type,
      e.occurred_at,
      CASE WHEN dc.is_present = true THEN dc.restart_count ELSE e.restart_count END AS restart_count
    FROM docker_container_lifecycle_events e
    LEFT JOIN docker_containers dc
      ON dc.id = e.docker_container_row_id
     AND dc.instance_id = e.instance_id
     AND dc.host_id = e.host_id
     AND dc.docker_container_id = e.docker_container_id
    WHERE e.instance_id = ${instanceId}
      AND e.host_id = ${hostId}
    ORDER BY e.occurred_at DESC, e.created_at DESC
    LIMIT ${MAX_LIFECYCLE_EVENTS}
  `)

  return {
    events: Array.from(rows).map((row) => ({
      id: row.id,
      dockerContainerId: row.docker_container_id,
      primaryName: row.primary_name,
      image: row.image,
      state: row.state,
      status: row.status,
      eventType: row.event_type,
      occurredAt: new Date(row.occurred_at),
      restartCount: row.restart_count,
    })),
  }
}
