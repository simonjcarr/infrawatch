'use server'

import { logError } from '@/lib/logging'
import { requireOrgAccess } from '@/lib/actions/action-auth'

import { z } from 'zod'
import { db } from '@/lib/db'
import { tagRules, hosts } from '@/lib/db/schema'
import type { HostFilter, TagRule, TagPair } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { buildHostFilterWhere, isEmptyFilter, type HostFilterResult } from '@/lib/hosts/filter'
import { assignTagsToResource } from '@/lib/actions/tags'

const tagPairSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().min(1).max(500),
})

const hostFilterSchema: z.ZodType<HostFilter> = z.object({
  hostnameGlob: z.string().optional(),
  hostnameContains: z.string().optional(),
  ipCidrs: z.array(z.string().min(1)).optional(),
  networkInterfaceName: z.string().optional(),
  os: z.array(z.string()).optional(),
  osVersionContains: z.string().optional(),
  arch: z.array(z.string()).optional(),
  status: z.array(z.enum(['online', 'offline', 'unknown'])).optional(),
  hasTags: z.array(z.object({ key: z.string().min(1), value: z.string().optional() })).optional(),
  lacksTags: z.array(z.object({ key: z.string().min(1), value: z.string().optional() })).optional(),
})

const createRuleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  filter: hostFilterSchema,
  tags: z.array(tagPairSchema).min(1, 'At least one tag is required'),
  enabled: z.boolean().default(true),
})

// Returns matching hosts without mutating anything. Used for the "Preview
// matches" step in the bulk-tag UI before the user commits the change.
export async function previewHostFilter(
  orgId: string,
  filter: HostFilter,
): Promise<HostFilterResult[]> {
  await requireOrgAccess(orgId)
  const parsed = hostFilterSchema.safeParse(filter)
  if (!parsed.success) return []
  if (isEmptyFilter(parsed.data)) return []

  const where = buildHostFilterWhere(orgId, parsed.data)
  if (!where) return []

  const rows = await db
    .select({
      id: hosts.id,
      hostname: hosts.hostname,
      displayName: hosts.displayName,
      os: hosts.os,
      status: hosts.status,
      ipAddresses: hosts.ipAddresses,
    })
    .from(hosts)
    .where(where)
    .limit(1000)

  return rows as HostFilterResult[]
}

// One-shot bulk assign — matches the filter now and applies tags to every
// matching host. Does NOT persist the rule; use createTagRule for that.
export async function bulkAssignTags(
  orgId: string,
  filter: HostFilter,
  pairs: TagPair[],
): Promise<{ success: true; applied: number } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    const parsedFilter = hostFilterSchema.safeParse(filter)
    if (!parsedFilter.success) return { error: 'Invalid filter' }
    const parsedTags = z.array(tagPairSchema).min(1).safeParse(pairs)
    if (!parsedTags.success) return { error: 'At least one tag is required' }
    if (isEmptyFilter(parsedFilter.data)) return { error: 'Filter must target at least one host' }

    const matches = await previewHostFilter(orgId, parsedFilter.data)
    let applied = 0
    for (const host of matches) {
      const res = await assignTagsToResource(orgId, 'host', host.id, parsedTags.data)
      if ('success' in res) applied += 1
    }
    return { success: true, applied }
  } catch (err) {
    logError('Failed to bulk assign tags:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function listTagRules(orgId: string): Promise<TagRule[]> {
  await requireOrgAccess(orgId)
  return db.query.tagRules.findMany({
    where: and(eq(tagRules.organisationId, orgId), isNull(tagRules.deletedAt)),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  })
}

export async function createTagRule(
  orgId: string,
  input: { name: string; filter: HostFilter; tags: TagPair[]; enabled?: boolean },
): Promise<{ success: true; id: string } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    const parsed = createRuleSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

    const [row] = await db
      .insert(tagRules)
      .values({
        organisationId: orgId,
        name: parsed.data.name,
        filter: parsed.data.filter,
        tags: parsed.data.tags,
        enabled: parsed.data.enabled,
      })
      .returning({ id: tagRules.id })
    if (!row) return { error: 'Failed to create rule' }
    return { success: true, id: row.id }
  } catch (err) {
    logError('Failed to create tag rule:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateTagRule(
  orgId: string,
  ruleId: string,
  input: Partial<{ name: string; filter: HostFilter; tags: TagPair[]; enabled: boolean }>,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    const existing = await db.query.tagRules.findFirst({
      where: and(
        eq(tagRules.id, ruleId),
        eq(tagRules.organisationId, orgId),
        isNull(tagRules.deletedAt),
      ),
    })
    if (!existing) return { error: 'Rule not found' }

    const next = {
      name: input.name ?? existing.name,
      filter: input.filter ?? existing.filter,
      tags: input.tags ?? existing.tags,
      enabled: input.enabled ?? existing.enabled,
    }
    const parsed = createRuleSchema.safeParse(next)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

    await db
      .update(tagRules)
      .set({
        name: parsed.data.name,
        filter: parsed.data.filter,
        tags: parsed.data.tags,
        enabled: parsed.data.enabled,
        updatedAt: new Date(),
      })
      .where(and(eq(tagRules.id, ruleId), eq(tagRules.organisationId, orgId)))
    return { success: true }
  } catch (err) {
    logError('Failed to update tag rule:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteTagRule(
  orgId: string,
  ruleId: string,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    await db
      .update(tagRules)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tagRules.id, ruleId), eq(tagRules.organisationId, orgId)))
    return { success: true }
  } catch (err) {
    logError('Failed to delete tag rule:', err)
    return { error: 'An unexpected error occurred' }
  }
}

// Runs a saved rule against the current host population. Used both for the
// "Run now" button in the admin UI and (below) to auto-apply rules on host
// approval.
export async function runTagRule(
  orgId: string,
  ruleId: string,
): Promise<{ success: true; applied: number } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    const rule = await db.query.tagRules.findFirst({
      where: and(
        eq(tagRules.id, ruleId),
        eq(tagRules.organisationId, orgId),
        isNull(tagRules.deletedAt),
      ),
    })
    if (!rule) return { error: 'Rule not found' }
    return bulkAssignTags(orgId, rule.filter, rule.tags)
  } catch (err) {
    logError('Failed to run tag rule:', err)
    return { error: 'An unexpected error occurred' }
  }
}

// Evaluates every enabled rule against a single host and applies the tags for
// those that match. Called from approveAgent so new hosts pick up rule-driven
// tags automatically. Rules run last in the merge order — they never override
// per-host tags set by the operator because assignTagsToResource dedupes by
// key with last-wins and rule tags only fill in keys not already present.
export async function runMatchingTagRules(
  orgId: string,
  hostId: string,
): Promise<void> {
  await requireOrgAccess(orgId)
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
  })
  if (!host) return

  const rules = await db.query.tagRules.findMany({
    where: and(
      eq(tagRules.organisationId, orgId),
      eq(tagRules.enabled, true),
      isNull(tagRules.deletedAt),
    ),
  })

  for (const rule of rules) {
    const matches = await previewHostFilter(orgId, rule.filter)
    if (matches.some((m) => m.id === hostId)) {
      await assignTagsToResource(orgId, 'host', hostId, rule.tags)
    }
  }
}
