import type { SessionUser } from '@/lib/auth/session'
import type { Note } from '@/lib/db/schema'

const ADMIN_ROLES = ['org_admin', 'super_admin']

// v1 reachability is "same org". Tag-based RBAC does not yet exist in this
// codebase — once it does, notes should inherit the same host-reachability
// checks so a user cannot read notes for hosts they cannot see.
function isSameOrg(user: SessionUser, note: Pick<Note, 'organisationId'>): boolean {
  return user.organisationId === note.organisationId
}

export function canReadNote(
  user: SessionUser,
  note: Pick<Note, 'organisationId' | 'authorId' | 'isPrivate'>,
): boolean {
  if (!isSameOrg(user, note)) return false
  if (!note.isPrivate) return true
  if (note.authorId === user.id) return true
  return user.role === 'super_admin'
}

export function canWriteNote(
  user: SessionUser,
  note: Pick<Note, 'organisationId' | 'authorId'>,
): boolean {
  if (!isSameOrg(user, note)) return false
  if (user.role === 'read_only') return false
  if (note.authorId === user.id) return true
  return ADMIN_ROLES.includes(user.role)
}

export function canDeleteNote(
  user: SessionUser,
  note: Pick<Note, 'organisationId' | 'authorId'>,
): boolean {
  if (!isSameOrg(user, note)) return false
  if (note.authorId === user.id) return true
  return ADMIN_ROLES.includes(user.role)
}

// Only the author may flip the privacy toggle — admins cannot force-hide or
// force-share someone else's note without them knowing.
export function canTogglePrivate(
  user: SessionUser,
  note: Pick<Note, 'organisationId' | 'authorId'>,
): boolean {
  return isSameOrg(user, note) && note.authorId === user.id
}

export function canCreateNote(user: SessionUser): boolean {
  return user.role !== 'read_only'
}
