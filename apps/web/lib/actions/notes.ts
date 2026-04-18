'use server'

import { db } from '@/lib/db'
import {
  notes,
  noteTargets,
  noteRevisions,
  noteReactions,
  NOTE_CATEGORIES,
  NOTE_REACTIONS,
} from '@/lib/db/schema'
import {
  eq,
  and,
  isNull,
  desc,
  sql,
  inArray,
  or,
} from 'drizzle-orm'
import { z } from 'zod'
import { getRequiredSession } from '@/lib/auth/session'
import {
  canReadNote,
  canWriteNote,
  canDeleteNote,
  canTogglePrivate,
  canCreateNote,
} from '@/lib/auth/note-permissions'
import type {
  Note,
  NoteTarget,
  NoteRevision,
  NoteReaction,
  NoteCategory,
  NoteReactionType,
  NoteTargetType,
  NoteTagSelector,
} from '@/lib/db/schema'
import { resolveNotesForHost, type ResolvedNote } from './notes-resolver'

// ── Constants ────────────────────────────────────────────────────────────────

// Guard against the pinned-card panel becoming a dumping ground. Five strikes
// the balance between "enough space for real runbooks" and "still scannable at
// a glance on the Overview tab".
const MAX_PINS_PER_HOST = 5

// Keep revisions bounded on the UI side. The revisions table is append-only
// and will grow over the lifetime of a note; a later PR can introduce a
// retention sweep.
const MAX_REVISIONS_RENDERED = 50

// Debounce window — if the same author edits the same note within this window
// and the previous snapshot is still the tip, we skip writing a new revision.
// Prevents keystroke-save amplification from autosave UIs.
const REVISION_DEBOUNCE_MS = 60_000

// ── Zod ──────────────────────────────────────────────────────────────────────

const tagSelectorSchema = z.object({
  tags: z
    .array(z.object({ key: z.string().min(1).max(80), value: z.string().min(1).max(120) }))
    .min(1)
    .max(20),
  match: z.enum(['all', 'any']),
})

const targetSchema = z.discriminatedUnion('targetType', [
  z.object({
    targetType: z.literal('host'),
    targetId: z.string().min(1),
    isPinned: z.boolean().optional(),
  }),
  z.object({
    targetType: z.literal('host_group'),
    targetId: z.string().min(1),
    isPinned: z.boolean().optional(),
  }),
  z.object({
    targetType: z.literal('tag_selector'),
    tagSelector: tagSelectorSchema,
    isPinned: z.boolean().optional(),
  }),
])

const createNoteSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(50_000).default(''),
  category: z.enum(NOTE_CATEGORIES),
  isPrivate: z.boolean().default(false),
  targets: z.array(targetSchema).max(50).default([]),
})

const updateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(50_000).optional(),
  category: z.enum(NOTE_CATEGORIES).optional(),
})

// ── Read ─────────────────────────────────────────────────────────────────────

export async function listNotesForHost(
  orgId: string,
  hostId: string,
  filter?: { categories?: NoteCategory[]; includePrivate?: boolean },
): Promise<ResolvedNote[]> {
  return resolveNotesForHost(orgId, hostId, filter)
}

export async function listNotes(
  orgId: string,
  filter: {
    categories?: NoteCategory[]
    authorId?: string
    mineOnly?: boolean
  } = {},
): Promise<Note[]> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return []

  const conditions = [
    eq(notes.organisationId, orgId),
    isNull(notes.deletedAt),
    // Privacy: exclude other users' private notes unless you are the author or
    // super_admin.
    session.user.role === 'super_admin'
      ? undefined
      : or(eq(notes.isPrivate, false), eq(notes.authorId, session.user.id)),
  ].filter((c): c is NonNullable<typeof c> => c !== undefined)

  if (filter.categories && filter.categories.length > 0) {
    conditions.push(inArray(notes.category, filter.categories))
  }
  if (filter.authorId) {
    conditions.push(eq(notes.authorId, filter.authorId))
  }
  if (filter.mineOnly) {
    conditions.push(eq(notes.authorId, session.user.id))
  }

  return db
    .select()
    .from(notes)
    .where(and(...conditions))
    .orderBy(desc(notes.updatedAt))
    .limit(500)
}

// websearch_to_tsquery is forgiving of partial queries but still throws on
// truly malformed input — the ILIKE fallback means a user's search box always
// returns something sensible even if they paste an unbalanced quote.
export async function searchNotes(orgId: string, q: string): Promise<Note[]> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return []
  const trimmed = q.trim()
  if (trimmed.length === 0) return []

  const privacyFilter =
    session.user.role === 'super_admin'
      ? sql`TRUE`
      : sql`(n.is_private = FALSE OR n.author_id = ${session.user.id})`

  try {
    const rows = await db.execute(sql`
      SELECT n.*
      FROM notes n
      WHERE n.organisation_id = ${orgId}
        AND n.deleted_at IS NULL
        AND ${privacyFilter}
        AND n.search_vector @@ websearch_to_tsquery('english', ${trimmed})
      ORDER BY ts_rank(n.search_vector, websearch_to_tsquery('english', ${trimmed})) DESC,
               n.updated_at DESC
      LIMIT 50
    `)
    return rowsToNotes(rows)
  } catch {
    // tsquery parse errors fall through to a simple ILIKE on title.
    const like = `%${trimmed.replace(/[%_]/g, '\\$&')}%`
    const rows = await db.execute(sql`
      SELECT n.*
      FROM notes n
      WHERE n.organisation_id = ${orgId}
        AND n.deleted_at IS NULL
        AND ${privacyFilter}
        AND n.title ILIKE ${like}
      ORDER BY n.updated_at DESC
      LIMIT 50
    `)
    return rowsToNotes(rows)
  }
}

export async function getNote(
  orgId: string,
  noteId: string,
): Promise<{ note: Note; targets: NoteTarget[] } | null> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return null

  const note = await db.query.notes.findFirst({
    where: and(
      eq(notes.id, noteId),
      eq(notes.organisationId, orgId),
      isNull(notes.deletedAt),
    ),
  })
  if (!note) return null
  if (!canReadNote(session.user, note)) return null

  const targets = await db.query.noteTargets.findMany({
    where: and(eq(noteTargets.noteId, noteId), eq(noteTargets.organisationId, orgId)),
  })

  return { note, targets }
}

// ── Write ────────────────────────────────────────────────────────────────────

export async function createNote(
  orgId: string,
  input: z.input<typeof createNoteSchema>,
): Promise<{ success: true; note: Note } | { error: string }> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return { error: 'Not found' }
  if (!canCreateNote(session.user)) {
    return { error: 'You do not have permission to perform this action' }
  }

  const parsed = createNoteSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(notes)
        .values({
          organisationId: orgId,
          authorId: session.user.id,
          title: parsed.data.title,
          body: parsed.data.body,
          category: parsed.data.category,
          isPrivate: parsed.data.isPrivate,
        })
        .returning()
      if (!row) throw new Error('insert failed')

      // Seed the first revision so the timeline has a starting point.
      await tx.insert(noteRevisions).values({
        organisationId: orgId,
        noteId: row.id,
        editorId: session.user.id,
        title: row.title,
        body: row.body,
        category: row.category,
      })

      if (parsed.data.targets.length > 0) {
        await tx.insert(noteTargets).values(
          parsed.data.targets.map((t) => ({
            organisationId: orgId,
            noteId: row.id,
            targetType: t.targetType as NoteTargetType,
            targetId: t.targetType === 'tag_selector' ? null : t.targetId,
            tagSelector:
              t.targetType === 'tag_selector' ? (t.tagSelector as NoteTagSelector) : null,
            isPinned: t.isPinned ?? false,
          })),
        )
      }

      return row
    })
    return { success: true, note: created }
  } catch (err) {
    console.error('Failed to create note:', err)
    return { error: 'Failed to create note' }
  }
}

export async function updateNote(
  orgId: string,
  noteId: string,
  input: z.input<typeof updateNoteSchema>,
): Promise<{ success: true; note: Note } | { error: string }> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return { error: 'Not found' }

  const parsed = updateNoteSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  try {
    return await db.transaction(async (tx) => {
      const existing = await tx.query.notes.findFirst({
        where: and(
          eq(notes.id, noteId),
          eq(notes.organisationId, orgId),
          isNull(notes.deletedAt),
        ),
      })
      if (!existing) return { error: 'Note not found' }
      if (!canWriteNote(session.user, existing)) {
        return { error: 'You do not have permission to perform this action' }
      }

      const nextTitle = parsed.data.title ?? existing.title
      const nextBody = parsed.data.body ?? existing.body
      const nextCategory = parsed.data.category ?? existing.category

      const contentChanged =
        nextTitle !== existing.title ||
        nextBody !== existing.body ||
        nextCategory !== existing.category
      if (!contentChanged) {
        return { success: true as const, note: existing }
      }

      const [updated] = await tx
        .update(notes)
        .set({
          title: nextTitle,
          body: nextBody,
          category: nextCategory,
          lastEditedById: session.user.id,
          updatedAt: new Date(),
        })
        .where(and(eq(notes.id, noteId), eq(notes.organisationId, orgId)))
        .returning()
      if (!updated) return { error: 'Note not found' }

      // Revision debounce: if the same author last edited the note within the
      // window, skip writing another snapshot. Different author always snaps
      // so we never lose a change of hands on the audit trail.
      const latestRev = await tx.query.noteRevisions.findFirst({
        where: eq(noteRevisions.noteId, noteId),
        orderBy: (r, { desc: d }) => [d(r.createdAt)],
      })
      const sameAuthorRecent =
        latestRev &&
        latestRev.editorId === session.user.id &&
        Date.now() - new Date(latestRev.createdAt).getTime() < REVISION_DEBOUNCE_MS

      if (!sameAuthorRecent) {
        await tx.insert(noteRevisions).values({
          organisationId: orgId,
          noteId,
          editorId: session.user.id,
          title: updated.title,
          body: updated.body,
          category: updated.category,
        })
      }

      return { success: true as const, note: updated }
    })
  } catch (err) {
    console.error('Failed to update note:', err)
    return { error: 'Failed to update note' }
  }
}

export async function deleteNote(
  orgId: string,
  noteId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return { error: 'Not found' }

  try {
    const existing = await db.query.notes.findFirst({
      where: and(
        eq(notes.id, noteId),
        eq(notes.organisationId, orgId),
        isNull(notes.deletedAt),
      ),
    })
    if (!existing) return { error: 'Note not found' }
    if (!canDeleteNote(session.user, existing)) {
      return { error: 'You do not have permission to perform this action' }
    }

    await db
      .update(notes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notes.id, noteId), eq(notes.organisationId, orgId)))

    return { success: true }
  } catch (err) {
    console.error('Failed to delete note:', err)
    return { error: 'Failed to delete note' }
  }
}

// Replace all targets atomically. Callers use this for the target picker in
// the editor; pinning is preserved by pre-reading and re-applying isPinned
// where the caller passes it, otherwise defaults to false.
export async function setNoteTargets(
  orgId: string,
  noteId: string,
  targets: z.input<typeof targetSchema>[],
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return { error: 'Not found' }

  const parsed = z.array(targetSchema).max(50).safeParse(targets)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  try {
    return await db.transaction(async (tx) => {
      const existing = await tx.query.notes.findFirst({
        where: and(
          eq(notes.id, noteId),
          eq(notes.organisationId, orgId),
          isNull(notes.deletedAt),
        ),
      })
      if (!existing) return { error: 'Note not found' }
      if (!canWriteNote(session.user, existing)) {
        return { error: 'You do not have permission to perform this action' }
      }

      await tx
        .delete(noteTargets)
        .where(and(eq(noteTargets.noteId, noteId), eq(noteTargets.organisationId, orgId)))

      if (parsed.data.length > 0) {
        await tx.insert(noteTargets).values(
          parsed.data.map((t) => ({
            organisationId: orgId,
            noteId,
            targetType: t.targetType as NoteTargetType,
            targetId: t.targetType === 'tag_selector' ? null : t.targetId,
            tagSelector:
              t.targetType === 'tag_selector' ? (t.tagSelector as NoteTagSelector) : null,
            isPinned: t.isPinned ?? false,
          })),
        )
      }

      await tx
        .update(notes)
        .set({ updatedAt: new Date() })
        .where(eq(notes.id, noteId))

      return { success: true as const }
    })
  } catch (err) {
    console.error('Failed to set note targets:', err)
    return { error: 'Failed to update targets' }
  }
}

// Pin a note to a specific target (host or host_group). Tag-selector targets
// ignore pins — the resolver already filters those out.
export async function toggleNotePin(
  orgId: string,
  noteTargetId: string,
  pinned: boolean,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return { error: 'Not found' }

  try {
    return await db.transaction(async (tx) => {
      const target = await tx.query.noteTargets.findFirst({
        where: and(
          eq(noteTargets.id, noteTargetId),
          eq(noteTargets.organisationId, orgId),
        ),
      })
      if (!target) return { error: 'Target not found' }

      const note = await tx.query.notes.findFirst({
        where: and(
          eq(notes.id, target.noteId),
          eq(notes.organisationId, orgId),
          isNull(notes.deletedAt),
        ),
      })
      if (!note) return { error: 'Note not found' }
      if (!canWriteNote(session.user, note)) {
        return { error: 'You do not have permission to perform this action' }
      }
      if (target.targetType === 'tag_selector') {
        return { error: 'Tag-selector targets cannot be pinned' }
      }

      // Enforce the per-host pin cap when turning a pin on. Other notes pinned
      // to this same (targetType, targetId) share the budget.
      if (pinned && !target.isPinned && target.targetId) {
        const rows = await tx
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(noteTargets)
          .innerJoin(notes, eq(notes.id, noteTargets.noteId))
          .where(
            and(
              eq(noteTargets.organisationId, orgId),
              eq(noteTargets.targetType, target.targetType),
              eq(noteTargets.targetId, target.targetId),
              eq(noteTargets.isPinned, true),
              isNull(notes.deletedAt),
            ),
          )
        const count = rows[0]?.count ?? 0
        if (count >= MAX_PINS_PER_HOST) {
          return { error: `Pin limit reached (${MAX_PINS_PER_HOST} per target)` }
        }
      }

      await tx
        .update(noteTargets)
        .set({ isPinned: pinned })
        .where(eq(noteTargets.id, noteTargetId))

      return { success: true as const }
    })
  } catch (err) {
    console.error('Failed to toggle pin:', err)
    return { error: 'Failed to update pin' }
  }
}

// Author-only flag. Admins intentionally cannot flip someone else's note
// between private and shared — that preserves trust in the privacy toggle.
export async function toggleNotePrivate(
  orgId: string,
  noteId: string,
  isPrivate: boolean,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return { error: 'Not found' }

  try {
    const existing = await db.query.notes.findFirst({
      where: and(
        eq(notes.id, noteId),
        eq(notes.organisationId, orgId),
        isNull(notes.deletedAt),
      ),
    })
    if (!existing) return { error: 'Note not found' }
    if (!canTogglePrivate(session.user, existing)) {
      return { error: 'Only the author can change privacy' }
    }

    await db
      .update(notes)
      .set({ isPrivate, updatedAt: new Date() })
      .where(and(eq(notes.id, noteId), eq(notes.organisationId, orgId)))

    return { success: true }
  } catch (err) {
    console.error('Failed to toggle privacy:', err)
    return { error: 'Failed to update privacy' }
  }
}

// ── Reactions ────────────────────────────────────────────────────────────────

export async function addNoteReaction(
  orgId: string,
  noteId: string,
  reaction: NoteReactionType,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return { error: 'Not found' }
  if (!NOTE_REACTIONS.includes(reaction)) return { error: 'Invalid reaction' }

  try {
    const existing = await db.query.notes.findFirst({
      where: and(
        eq(notes.id, noteId),
        eq(notes.organisationId, orgId),
        isNull(notes.deletedAt),
      ),
    })
    if (!existing) return { error: 'Note not found' }
    if (!canReadNote(session.user, existing)) {
      return { error: 'Not found' }
    }

    await db
      .insert(noteReactions)
      .values({
        organisationId: orgId,
        noteId,
        userId: session.user.id,
        reaction,
      })
      .onConflictDoNothing({
        target: [noteReactions.noteId, noteReactions.userId, noteReactions.reaction],
      })

    return { success: true }
  } catch (err) {
    console.error('Failed to add reaction:', err)
    return { error: 'Failed to add reaction' }
  }
}

export async function removeNoteReaction(
  orgId: string,
  noteId: string,
  reaction: NoteReactionType,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return { error: 'Not found' }

  try {
    await db
      .delete(noteReactions)
      .where(
        and(
          eq(noteReactions.organisationId, orgId),
          eq(noteReactions.noteId, noteId),
          eq(noteReactions.userId, session.user.id),
          eq(noteReactions.reaction, reaction),
        ),
      )
    return { success: true }
  } catch (err) {
    console.error('Failed to remove reaction:', err)
    return { error: 'Failed to remove reaction' }
  }
}

export async function listNoteReactions(
  orgId: string,
  noteId: string,
): Promise<NoteReaction[]> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return []

  return db.query.noteReactions.findMany({
    where: and(eq(noteReactions.noteId, noteId), eq(noteReactions.organisationId, orgId)),
  })
}

// ── Revisions ────────────────────────────────────────────────────────────────

export async function listNoteRevisions(
  orgId: string,
  noteId: string,
): Promise<NoteRevision[]> {
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) return []

  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, noteId), eq(notes.organisationId, orgId)),
  })
  if (!note || !canReadNote(session.user, note)) return []

  return db.query.noteRevisions.findMany({
    where: and(
      eq(noteRevisions.noteId, noteId),
      eq(noteRevisions.organisationId, orgId),
    ),
    orderBy: (r, { desc: d }) => [d(r.createdAt)],
    limit: MAX_REVISIONS_RENDERED,
  })
}

// ── Internal ─────────────────────────────────────────────────────────────────

function rowsToNotes(rows: unknown): Note[] {
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    organisationId: r.organisation_id as string,
    authorId: r.author_id as string,
    lastEditedById: (r.last_edited_by_id as string | null) ?? null,
    title: r.title as string,
    body: r.body as string,
    category: r.category as NoteCategory,
    isPrivate: r.is_private as boolean,
    searchVector: (r.search_vector as string | null) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    deletedAt: (r.deleted_at as Date | null) ?? null,
    metadata: (r.metadata as Note['metadata']) ?? null,
  }))
}
