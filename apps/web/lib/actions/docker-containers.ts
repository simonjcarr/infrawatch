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

function cleanFilter(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === 'all') return undefined
  return trimmed.slice(0, MAX_FILTER_LENGTH)
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
