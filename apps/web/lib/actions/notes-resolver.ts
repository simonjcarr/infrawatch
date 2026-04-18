'use server'

import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getRequiredSession } from '@/lib/auth/session'
import type { Note, NoteCategory } from '@/lib/db/schema'

export type ResolvedNoteSource = 'direct' | 'group' | 'tag_selector'

// Strip the generated searchVector from the public shape — it's an opaque
// tsvector used only for indexing, and clients have no use for it.
export type ResolvedNote = Omit<Note, 'searchVector'> & {
  // Pin is per-target. A note only counts as "pinned for this host" if the
  // pin is on a direct host target or on a host_group target for one of the
  // groups this host belongs to — tag-selector matches never pin (avoids
  // runbooks spraying across every host matched by env:prod).
  isPinned: boolean
  sources: ResolvedNoteSource[]
}

// Resolves every visible, non-deleted note that applies to a host via any of
// the three targeting modes. Runs as a single CTE query so N-per-host stays
// under a few ms even with tens of thousands of notes per org. Materialising
// the result into a cache table is deferred — the CTE is small enough at v1
// scale and avoids a new invalidation surface.
export async function resolveNotesForHost(
  orgId: string,
  hostId: string,
  opts: { includePrivate?: boolean; categories?: NoteCategory[] } = {},
): Promise<ResolvedNote[]> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return []

  const userId = session.user.id
  const isSuperAdmin = session.user.role === 'super_admin'
  const includePrivateFilter = opts.includePrivate !== false

  const categoryFilter =
    opts.categories && opts.categories.length > 0
      ? sql`AND n.category = ANY(${opts.categories})`
      : sql``

  // CTE structure:
  //   direct       — note_targets with targetType='host' and targetId=$hostId
  //   host_groups  — group ids this host belongs to (soft-delete aware)
  //   via_group    — note_targets with targetType='host_group' and targetId in host_groups
  //   host_tags    — the host's (key,value) tag pairs, lowercased
  //   via_tag      — note_targets with targetType='tag_selector' whose jsonb matches
  //                  according to the selector's match mode (all vs any)
  //   matched      — union of the three, with per-target pin roll-up (any direct
  //                  or via_group pin counts as pinned; via_tag pins are ignored)
  //
  // Case-insensitive matching mirrors the existing tags semantics (tags table
  // uniquely indexes lower(key), lower(value)).
  const rows = await db.execute(sql`
    WITH direct AS (
      SELECT nt.note_id, nt.is_pinned
      FROM note_targets nt
      WHERE nt.organisation_id = ${orgId}
        AND nt.target_type = 'host'
        AND nt.target_id = ${hostId}
    ),
    host_groups_cte AS (
      SELECT hgm.group_id
      FROM host_group_members hgm
      WHERE hgm.organisation_id = ${orgId}
        AND hgm.host_id = ${hostId}
        AND hgm.deleted_at IS NULL
    ),
    via_group AS (
      SELECT nt.note_id, nt.is_pinned
      FROM note_targets nt
      JOIN host_groups_cte g ON g.group_id = nt.target_id
      WHERE nt.organisation_id = ${orgId}
        AND nt.target_type = 'host_group'
    ),
    host_tags AS (
      SELECT lower(t.key) AS key, lower(t.value) AS value
      FROM resource_tags rt
      JOIN tags t ON t.id = rt.tag_id
      WHERE rt.organisation_id = ${orgId}
        AND rt.resource_type = 'host'
        AND rt.resource_id = ${hostId}
    ),
    via_tag AS (
      SELECT nt.note_id
      FROM note_targets nt
      WHERE nt.organisation_id = ${orgId}
        AND nt.target_type = 'tag_selector'
        AND nt.tag_selector IS NOT NULL
        AND (
          -- match: 'all' — every selector tag must be present on the host
          (
            nt.tag_selector->>'match' = 'all'
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(nt.tag_selector->'tags') sel
              WHERE NOT EXISTS (
                SELECT 1 FROM host_tags ht
                WHERE ht.key = lower(sel->>'key')
                  AND ht.value = lower(sel->>'value')
              )
            )
            AND jsonb_array_length(nt.tag_selector->'tags') > 0
          )
          OR
          -- match: 'any' — at least one selector tag must be present
          (
            nt.tag_selector->>'match' = 'any'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(nt.tag_selector->'tags') sel
              JOIN host_tags ht
                ON ht.key = lower(sel->>'key')
                AND ht.value = lower(sel->>'value')
            )
          )
        )
    ),
    matched AS (
      SELECT note_id,
             BOOL_OR(is_pinned) AS is_pinned,
             ARRAY_AGG(DISTINCT source) AS sources
      FROM (
        SELECT note_id, is_pinned, 'direct'::text AS source FROM direct
        UNION ALL
        SELECT note_id, is_pinned, 'group'::text AS source FROM via_group
        UNION ALL
        SELECT note_id, FALSE AS is_pinned, 'tag_selector'::text AS source FROM via_tag
      ) u
      GROUP BY note_id
    )
    SELECT
      n.id, n.organisation_id, n.author_id, n.last_edited_by_id,
      n.title, n.body, n.category, n.is_private,
      n.created_at, n.updated_at, n.deleted_at, n.metadata,
      m.is_pinned, m.sources
    FROM matched m
    JOIN notes n ON n.id = m.note_id
    WHERE n.deleted_at IS NULL
      AND n.organisation_id = ${orgId}
      AND (
        ${includePrivateFilter ? sql`(n.is_private = FALSE OR n.author_id = ${userId} OR ${isSuperAdmin})` : sql`n.is_private = FALSE`}
      )
      ${categoryFilter}
    ORDER BY m.is_pinned DESC, n.updated_at DESC
  `)

  // db.execute returns raw snake_case rows — map to the typed shape the rest
  // of the app consumes.
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    organisationId: r.organisation_id as string,
    authorId: r.author_id as string,
    lastEditedById: (r.last_edited_by_id as string | null) ?? null,
    title: r.title as string,
    body: r.body as string,
    category: r.category as NoteCategory,
    isPrivate: r.is_private as boolean,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    deletedAt: (r.deleted_at as Date | null) ?? null,
    metadata: (r.metadata as Note['metadata']) ?? null,
    isPinned: r.is_pinned as boolean,
    sources: r.sources as ResolvedNoteSource[],
  }))
}
