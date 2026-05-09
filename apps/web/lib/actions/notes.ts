'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  addNoteReaction as addNoteReactionCore,
  createNote as createNoteCore,
  deleteNote as deleteNoteCore,
  getNote as getNoteCore,
  listNoteReactions as listNoteReactionsCore,
  listNoteRevisions as listNoteRevisionsCore,
  listNotes as listNotesCore,
  listNotesForHost as listNotesForHostCore,
  removeNoteReaction as removeNoteReactionCore,
  searchNotes as searchNotesCore,
  setNoteTargets as setNoteTargetsCore,
  toggleNotePin as toggleNotePinCore,
  toggleNotePrivate as toggleNotePrivateCore,
  updateNote as updateNoteCore,
} from './notes-core'

export async function listNotesForHost(
  hostId: string,
  filter?: { categories?: import('@/lib/db/schema').NoteCategory[]; includePrivate?: boolean },
): Promise<import('./notes-resolver').ResolvedNote[]> {
  const session = await getRequiredSession()
  const currentScope = resolveCurrentActionScope(session)
  return listNotesForHostCore(currentScope, hostId, filter)
}

export async function listNotes(
  scopeId: string,
  filter: {
    categories?: import('@/lib/db/schema').NoteCategory[]
    authorId?: string
    mineOnly?: boolean
  } = {},
): Promise<import('@/lib/db/schema').Note[]> {
  return listNotesCore(scopeId, filter)
}

export async function searchNotes(
  scopeId: string,
  query: string,
): Promise<import('@/lib/db/schema').Note[]> {
  return searchNotesCore(scopeId, query)
}

export async function getNote(
  scopeId: string,
  noteId: string,
): Promise<{ note: import('@/lib/db/schema').Note; targets: import('@/lib/db/schema').NoteTarget[] } | null> {
  return getNoteCore(scopeId, noteId)
}

export async function createNote(
  input: Parameters<typeof createNoteCore>[1],
): Promise<{ success: true; note: import('@/lib/db/schema').Note } | { error: string }> {
  const session = await getRequiredSession()
  const currentScope = resolveCurrentActionScope(session)
  return createNoteCore(currentScope, input)
}

export async function updateNote(
  noteId: string,
  input: Parameters<typeof updateNoteCore>[2],
): Promise<{ success: true; note: import('@/lib/db/schema').Note } | { error: string }> {
  const session = await getRequiredSession()
  const currentScope = resolveCurrentActionScope(session)
  return updateNoteCore(currentScope, noteId, input)
}

export async function deleteNote(
  noteId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const currentScope = resolveCurrentActionScope(session)
  return deleteNoteCore(currentScope, noteId)
}

export async function setNoteTargets(
  scopeId: string,
  noteId: string,
  targets: Parameters<typeof setNoteTargetsCore>[2],
): Promise<{ success: true } | { error: string }> {
  return setNoteTargetsCore(scopeId, noteId, targets)
}

export async function toggleNotePin(
  targetId: string,
  pinned: boolean,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const currentScope = resolveCurrentActionScope(session)
  return toggleNotePinCore(currentScope, targetId, pinned)
}

export async function toggleNotePrivate(
  noteId: string,
  isPrivate: boolean,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const currentScope = resolveCurrentActionScope(session)
  return toggleNotePrivateCore(currentScope, noteId, isPrivate)
}

export async function addNoteReaction(
  scopeId: string,
  noteId: string,
  reaction: import('@/lib/db/schema').NoteReactionType,
): Promise<{ success: true } | { error: string }> {
  return addNoteReactionCore(scopeId, noteId, reaction)
}

export async function removeNoteReaction(
  scopeId: string,
  noteId: string,
  reaction: import('@/lib/db/schema').NoteReactionType,
): Promise<{ success: true } | { error: string }> {
  return removeNoteReactionCore(scopeId, noteId, reaction)
}

export async function listNoteReactions(
  scopeId: string,
  noteId: string,
): Promise<import('@/lib/db/schema').NoteReaction[]> {
  return listNoteReactionsCore(scopeId, noteId)
}

export async function listNoteRevisions(
  scopeId: string,
  noteId: string,
): Promise<import('@/lib/db/schema').NoteRevision[]> {
  return listNoteRevisionsCore(scopeId, noteId)
}
