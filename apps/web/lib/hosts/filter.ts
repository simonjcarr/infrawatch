import { and, eq, isNull, sql, inArray, SQL } from 'drizzle-orm'
import { hosts, resourceTags, tags } from '@/lib/db/schema'
import type { HostFilter } from '@/lib/db/schema'

// Converts an fnmatch-style glob (supports *, ?) into a LIKE pattern. Escapes
// literal LIKE metacharacters (% and _) so a glob like "web-1" matches only
// the literal string.
function globToLike(glob: string): string {
  return glob
    .replace(/([%_\\])/g, '\\$1')
    .replace(/\*/g, '%')
    .replace(/\?/g, '_')
}

export interface HostFilterResult {
  id: string
  hostname: string
  displayName: string | null
  os: string | null
  status: 'online' | 'offline' | 'unknown'
  ipAddresses: string[] | null
}

// Builds a Drizzle WHERE clause for a host filter. All supplied fields AND
// together. Returned SQL is always org-scoped and excludes soft-deleted hosts.
export function buildHostFilterWhere(instanceId: string, filter: HostFilter): SQL | undefined {
  const conditions: SQL[] = [
    eq(hosts.instanceId, instanceId),
    isNull(hosts.deletedAt) as SQL,
  ]

  if (filter.hostnameGlob && filter.hostnameGlob.trim()) {
    conditions.push(sql`${hosts.hostname} LIKE ${globToLike(filter.hostnameGlob.trim())}`)
  }
  if (filter.hostnameContains && filter.hostnameContains.trim()) {
    const needle = `%${filter.hostnameContains.trim().replace(/([%_\\])/g, '\\$1')}%`
    conditions.push(sql`${hosts.hostname} ILIKE ${needle}`)
  }
  if (filter.ipCidrs && filter.ipCidrs.length > 0) {
    // Any IP in the host's jsonb ip_addresses array falling inside any of the
    // provided CIDRs. Uses the Postgres inet `<<=` containment operator.
    conditions.push(sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(${hosts.ipAddresses}) ip
      WHERE ip::inet <<= ANY(${filter.ipCidrs}::cidr[])
    )`)
  }
  if (filter.networkInterfaceName && filter.networkInterfaceName.trim()) {
    const name = filter.networkInterfaceName.trim()
    conditions.push(sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(${hosts.metadata}->'network_interfaces') ni
      WHERE lower(ni->>'name') = lower(${name})
    )`)
  }
  if (filter.os && filter.os.length > 0) {
    conditions.push(inArray(hosts.os, filter.os))
  }
  if (filter.osVersionContains && filter.osVersionContains.trim()) {
    const needle = `%${filter.osVersionContains.trim().replace(/([%_\\])/g, '\\$1')}%`
    conditions.push(sql`${hosts.osVersion} ILIKE ${needle}`)
  }
  if (filter.arch && filter.arch.length > 0) {
    conditions.push(inArray(hosts.arch, filter.arch))
  }
  if (filter.status && filter.status.length > 0) {
    conditions.push(inArray(hosts.status, filter.status))
  }
  if (filter.hasTags && filter.hasTags.length > 0) {
    for (const t of filter.hasTags) {
      const valueClause = t.value
        ? sql`AND lower(tg.value) = lower(${t.value})`
        : sql``
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${resourceTags} rt
        INNER JOIN ${tags} tg ON tg.id = rt.tag_id
        WHERE rt.instance_id = ${instanceId}
          AND rt.resource_id = ${hosts.id}
          AND rt.resource_type = 'host'
          AND lower(tg.key) = lower(${t.key})
          ${valueClause}
      )`)
    }
  }
  if (filter.lacksTags && filter.lacksTags.length > 0) {
    for (const t of filter.lacksTags) {
      const valueClause = t.value
        ? sql`AND lower(tg.value) = lower(${t.value})`
        : sql``
      conditions.push(sql`NOT EXISTS (
        SELECT 1 FROM ${resourceTags} rt
        INNER JOIN ${tags} tg ON tg.id = rt.tag_id
        WHERE rt.instance_id = ${instanceId}
          AND rt.resource_id = ${hosts.id}
          AND rt.resource_type = 'host'
          AND lower(tg.key) = lower(${t.key})
          ${valueClause}
      )`)
    }
  }

  return conditions.length > 0 ? and(...conditions) : undefined
}

export function isEmptyFilter(filter: HostFilter): boolean {
  const hasText = (s?: string) => !!(s && s.trim())
  const hasArr = <T>(a?: T[]) => !!(a && a.length > 0)
  return !(
    hasText(filter.hostnameGlob) ||
    hasText(filter.hostnameContains) ||
    hasArr(filter.ipCidrs) ||
    hasText(filter.networkInterfaceName) ||
    hasArr(filter.os) ||
    hasText(filter.osVersionContains) ||
    hasArr(filter.arch) ||
    hasArr(filter.status) ||
    hasArr(filter.hasTags) ||
    hasArr(filter.lacksTags)
  )
}
