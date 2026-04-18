import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { users } from './auth'

export const NOTE_CATEGORIES = [
  'general',
  'runbook',
  'known-issue',
  'fix',
  'contact',
  'workaround',
] as const
export type NoteCategory = (typeof NOTE_CATEGORIES)[number]

export const NOTE_TARGET_TYPES = ['host', 'host_group', 'tag_selector'] as const
export type NoteTargetType = (typeof NOTE_TARGET_TYPES)[number]

export const NOTE_REACTIONS = ['helpful', 'outdated'] as const
export type NoteReactionType = (typeof NOTE_REACTIONS)[number]

// A tag_selector target carries the list of tags + match mode in JSONB. Match
// semantics: 'all' requires every tag to be present on the host; 'any' requires
// at least one. Keys and values are matched case-insensitively in the resolver.
export interface NoteTagSelector {
  tags: Array<{ key: string; value: string }>
  match: 'all' | 'any'
}

// Reserved for category-template-derived structured fields in future PRs.
// Keeping it as an open shape avoids a migration when we introduce e.g. runbook
// step metadata or contact owner fields.
export type NoteMetadata = Record<string, unknown>

// Drizzle lacks a first-class tsvector type — define a custom type so generated
// column + GIN index work end-to-end via db:generate instead of hand-written
// SQL (see CLAUDE.md migration rule).
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector'
  },
})

export const notes = pgTable(
  'notes',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    lastEditedById: text('last_edited_by_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    category: text('category').notNull().default('general').$type<NoteCategory>(),
    isPrivate: boolean('is_private').notNull().default(false),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<NoteMetadata>(),
  },
  (t) => [
    index('notes_org_active_updated_idx').on(t.organisationId, t.deletedAt, t.updatedAt),
    index('notes_author_idx').on(t.authorId),
    index('notes_search_vector_idx').using('gin', t.searchVector),
  ],
)

// Polymorphic scope. One note can have many targets; target_id is the host or
// host_group id for those target types, NULL for tag_selector (where the
// selector itself lives in tag_selector jsonb). Pin is per-target so a runbook
// attached to a tag selector does not automatically pin on every matched host
// — only direct host / host_group pins surface in the Overview card.
export const noteTargets = pgTable(
  'note_targets',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id),
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull().$type<NoteTargetType>(),
    targetId: text('target_id'),
    tagSelector: jsonb('tag_selector').$type<NoteTagSelector>(),
    isPinned: boolean('is_pinned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('note_targets_type_id_idx').on(t.targetType, t.targetId),
    index('note_targets_note_idx').on(t.noteId),
    uniqueIndex('note_targets_direct_unique_uidx')
      .on(t.noteId, t.targetType, t.targetId)
      .where(sql`${t.targetId} IS NOT NULL`),
  ],
)

// Immutable edit history. Every meaningful change to title / body / category
// writes a new row; the server action debounces to avoid keystroke-save
// amplification (see notes.ts).
export const noteRevisions = pgTable(
  'note_revisions',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id),
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    editorId: text('editor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    category: text('category').notNull().$type<NoteCategory>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('note_revisions_note_created_idx').on(t.noteId, t.createdAt)],
)

// Lightweight trust signals. One user × note × reaction triple is unique so
// the same user cannot double-count 'helpful'. Separate reactions share the
// unique index key so a user can mark both 'helpful' and 'outdated' (rare but
// not worth forbidding).
export const noteReactions = pgTable(
  'note_reactions',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id),
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reaction: text('reaction').notNull().$type<NoteReactionType>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('note_reactions_unique_uidx').on(t.noteId, t.userId, t.reaction),
    index('note_reactions_note_idx').on(t.noteId),
  ],
)

export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert
export type NoteTarget = typeof noteTargets.$inferSelect
export type NewNoteTarget = typeof noteTargets.$inferInsert
export type NoteRevision = typeof noteRevisions.$inferSelect
export type NewNoteRevision = typeof noteRevisions.$inferInsert
export type NoteReaction = typeof noteReactions.$inferSelect
export type NewNoteReaction = typeof noteReactions.$inferInsert
