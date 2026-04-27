'use server'

import { logError } from '@/lib/logging'
import { requireOrgAccess } from '@/lib/actions/action-auth'

import { z } from 'zod'
import { db } from '@/lib/db'
import { tags, resourceTags, organisations } from '@/lib/db/schema'
import type { Tag, TagPair, OrgMetadata } from '@/lib/db/schema'
import { and, eq, sql, inArray, desc, asc } from 'drizzle-orm'
import { parseOrgMetadata } from '@/lib/db/schema/organisations'

export type TagAssignment = {
  resourceTagId: string
  tagId: string
  key: string
  value: string
}

const tagPairSchema = z.object({
  key: z.string().min(1, 'Tag key is required').max(100),
  value: z.string().min(1, 'Tag value is required').max(500),
})

// Deduplicates an incoming list by key (case-insensitive), last-wins. Used to
// enforce single-value-per-key-per-host at the edge of every write path.
function dedupeByKey(pairs: TagPair[]): TagPair[] {
  const byKey = new Map<string, TagPair>()
  for (const p of pairs) {
    byKey.set(p.key.toLowerCase(), { key: p.key, value: p.value })
  }
  return [...byKey.values()]
}

// Merges layers of {key,value} pairs with last-wins on conflicting keys. The
// caller passes layers from weakest to strongest (e.g. org defaults, token
// tags, CLI tags) so the final set reflects the operator's most-specific
// intent.
export async function mergeTagLayers(...layers: TagPair[][]): Promise<TagPair[]> {
  const flat: TagPair[] = []
  for (const layer of layers) flat.push(...layer)
  return dedupeByKey(flat)
}

export async function searchTags(
  orgId: string,
  query: string,
  opts?: { key?: string; limit?: number },
): Promise<Tag[]> {
  await requireOrgAccess(orgId)
  const q = (query ?? '').trim()
  const limit = Math.min(Math.max(opts?.limit ?? 10, 1), 50)

  // Prefix match on key or value. When a key context is supplied, narrow to
  // values under that key so the UI can scope value suggestions to the chosen
  // key (the core dedupe UX — typing `env` then `pr` only surfaces values
  // already used under `env`).
  const conditions = [eq(tags.organisationId, orgId)]
  if (opts?.key) {
    conditions.push(sql`lower(${tags.key}) = lower(${opts.key})`)
    if (q) conditions.push(sql`lower(${tags.value}) LIKE lower(${q + '%'})`)
  } else if (q) {
    conditions.push(
      sql`(lower(${tags.key}) LIKE lower(${q + '%'}) OR lower(${tags.value}) LIKE lower(${q + '%'}))`,
    )
  }

  return db
    .select()
    .from(tags)
    .where(and(...conditions))
    .orderBy(desc(tags.usageCount), asc(tags.key), asc(tags.value))
    .limit(limit)
}

// Looks up an existing tag case-insensitively, inserting it if absent. The
// case-insensitive unique index on (org_id, lower(key), lower(value)) is
// enforced by Postgres; we select-then-insert with a fallback re-select so
// concurrent callers never see a unique violation bubble up.
async function upsertTag(
  tx: typeof db,
  orgId: string,
  pair: TagPair,
): Promise<string> {
  const existing = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(
      and(
        eq(tags.organisationId, orgId),
        sql`lower(${tags.key}) = lower(${pair.key})`,
        sql`lower(${tags.value}) = lower(${pair.value})`,
      ),
    )
    .limit(1)
  if (existing[0]?.id) return existing[0].id

  try {
    const [row] = await tx
      .insert(tags)
      .values({ organisationId: orgId, key: pair.key, value: pair.value, usageCount: 0 })
      .returning({ id: tags.id })
    if (row?.id) return row.id
  } catch {
    // Concurrent insert won the race — re-read.
  }

  const retry = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(
      and(
        eq(tags.organisationId, orgId),
        sql`lower(${tags.key}) = lower(${pair.key})`,
        sql`lower(${tags.value}) = lower(${pair.value})`,
      ),
    )
    .limit(1)
  const id = retry[0]?.id
  if (!id) throw new Error('Tag upsert could not resolve tag id')
  return id
}

export async function assignTagsToResource(
  orgId: string,
  resourceType: string,
  resourceId: string,
  pairs: TagPair[],
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    const parsed = z.array(tagPairSchema).safeParse(pairs)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid tags' }
    const deduped = dedupeByKey(parsed.data)
    if (deduped.length === 0) return { success: true }

    await db.transaction(async (tx) => {
      for (const p of deduped) {
        const tagId = await upsertTag(tx as unknown as typeof db, orgId, p)
        const inserted = await tx
          .insert(resourceTags)
          .values({ organisationId: orgId, resourceId, resourceType, tagId })
          .onConflictDoNothing({
            target: [resourceTags.resourceId, resourceTags.resourceType, resourceTags.tagId],
          })
          .returning({ id: resourceTags.id })
        // Only bump usage when this was a fresh assignment
        if (inserted.length > 0) {
          await tx
            .update(tags)
            .set({ usageCount: sql`${tags.usageCount} + 1` })
            .where(eq(tags.id, tagId))
        }
      }
    })
    return { success: true }
  } catch (err) {
    logError('Failed to assign tags:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function removeTagFromResource(
  orgId: string,
  resourceTagId: string,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    const row = await db.query.resourceTags.findFirst({
      where: and(eq(resourceTags.id, resourceTagId), eq(resourceTags.organisationId, orgId)),
    })
    if (!row) return { error: 'Tag assignment not found' }

    await db.transaction(async (tx) => {
      await tx
        .delete(resourceTags)
        .where(and(eq(resourceTags.id, resourceTagId), eq(resourceTags.organisationId, orgId)))
      await tx
        .update(tags)
        .set({ usageCount: sql`GREATEST(${tags.usageCount} - 1, 0)` })
        .where(eq(tags.id, row.tagId))
    })
    return { success: true }
  } catch (err) {
    logError('Failed to remove tag:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function replaceResourceTags(
  orgId: string,
  resourceType: string,
  resourceId: string,
  pairs: TagPair[],
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    const parsed = z.array(tagPairSchema).safeParse(pairs)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid tags' }
    const deduped = dedupeByKey(parsed.data)

    // Fetch current assignments (for the host) so we can diff. Pre-loading
    // the existing set keeps the transaction short and lets us skip rows that
    // are already correct.
    const current = await db
      .select({ rtId: resourceTags.id, tagId: resourceTags.tagId, key: tags.key, value: tags.value })
      .from(resourceTags)
      .innerJoin(tags, eq(tags.id, resourceTags.tagId))
      .where(
        and(
          eq(resourceTags.organisationId, orgId),
          eq(resourceTags.resourceId, resourceId),
          eq(resourceTags.resourceType, resourceType),
        ),
      )

    const desiredByKey = new Map(deduped.map((p) => [p.key.toLowerCase(), p]))
    const keepRtIds: string[] = []
    const toRemoveRtIds: string[] = []
    const toRemoveTagIds: string[] = []
    for (const row of current) {
      const desired = desiredByKey.get(row.key.toLowerCase())
      if (desired && desired.value.toLowerCase() === row.value.toLowerCase()) {
        keepRtIds.push(row.rtId)
        desiredByKey.delete(row.key.toLowerCase())
      } else {
        toRemoveRtIds.push(row.rtId)
        toRemoveTagIds.push(row.tagId)
      }
    }
    const toAdd = [...desiredByKey.values()]

    await db.transaction(async (tx) => {
      if (toRemoveRtIds.length > 0) {
        await tx
          .delete(resourceTags)
          .where(inArray(resourceTags.id, toRemoveRtIds))
        for (const tagId of toRemoveTagIds) {
          await tx
            .update(tags)
            .set({ usageCount: sql`GREATEST(${tags.usageCount} - 1, 0)` })
            .where(eq(tags.id, tagId))
        }
      }
      for (const p of toAdd) {
        const tagId = await upsertTag(tx as unknown as typeof db, orgId, p)
        const inserted = await tx
          .insert(resourceTags)
          .values({ organisationId: orgId, resourceId, resourceType, tagId })
          .onConflictDoNothing({
            target: [resourceTags.resourceId, resourceTags.resourceType, resourceTags.tagId],
          })
          .returning({ id: resourceTags.id })
        if (inserted.length > 0) {
          await tx
            .update(tags)
            .set({ usageCount: sql`${tags.usageCount} + 1` })
            .where(eq(tags.id, tagId))
        }
      }
    })
    return { success: true }
  } catch (err) {
    logError('Failed to replace tags:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function listResourceTags(
  orgId: string,
  resourceType: string,
  resourceId: string,
): Promise<TagAssignment[]> {
  await requireOrgAccess(orgId)
  const rows = await db
    .select({
      resourceTagId: resourceTags.id,
      tagId: tags.id,
      key: tags.key,
      value: tags.value,
    })
    .from(resourceTags)
    .innerJoin(tags, eq(tags.id, resourceTags.tagId))
    .where(
      and(
        eq(resourceTags.organisationId, orgId),
        eq(resourceTags.resourceId, resourceId),
        eq(resourceTags.resourceType, resourceType),
      ),
    )
    .orderBy(asc(tags.key), asc(tags.value))
  return rows
}

export async function getOrgDefaultTags(orgId: string): Promise<TagPair[]> {
  await requireOrgAccess(orgId)
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  const meta = parseOrgMetadata(org?.metadata)
  return meta?.defaultTags ?? []
}

export async function updateOrgDefaultTags(
  orgId: string,
  pairs: TagPair[],
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    const parsed = z.array(tagPairSchema).safeParse(pairs)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid tags' }
    const deduped = dedupeByKey(parsed.data)

    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
      columns: { id: true, metadata: true },
    })
    if (!org) return { error: 'Organisation not found' }

    const currentMetadata = parseOrgMetadata(org.metadata)
    const updatedMetadata: OrgMetadata = {
      ...currentMetadata,
      defaultTags: deduped,
    }
    await db
      .update(organisations)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(organisations.id, orgId))

    return { success: true }
  } catch (err) {
    logError('Failed to update org default tags:', err)
    return { error: 'An unexpected error occurred' }
  }
}
