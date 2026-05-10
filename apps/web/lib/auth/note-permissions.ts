import type { SessionUser } from '@/lib/auth/session'
import type { Note } from '@/lib/db/schema'
import { ADMIN_ROLES } from '@/lib/auth/roles'

// v1 reachability is "same instance". Tag-based RBAC does not yet exist in this
// codebase — once it does, notes should inherit the same host-reachability
// checks so a user cannot read notes for hosts they cannot see.
function isSameInstance(user: SessionUser, note: Pick<Note, 'instanceId'>): boolean {
  return user.instanceId === note.instanceId
}

export function canReadNote(
  user: SessionUser,
  note: Pick<Note, 'instanceId' | 'authorId' | 'isPrivate'>,
): boolean {
  if (!isSameInstance(user, note)) return false
  if (!note.isPrivate) return true
  if (note.authorId === user.id) return true
  return user.role === 'super_admin'
}

export function canWriteNote(
  user: SessionUser,
  note: Pick<Note, 'instanceId' | 'authorId'>,
): boolean {
  if (!isSameInstance(user, note)) return false
  if (user.role === 'read_only') return false
  if (note.authorId === user.id) return true
  return ADMIN_ROLES.includes(user.role)
}

export function canDeleteNote(
  user: SessionUser,
  note: Pick<Note, 'instanceId' | 'authorId'>,
): boolean {
  if (!isSameInstance(user, note)) return false
  if (note.authorId === user.id) return true
  return ADMIN_ROLES.includes(user.role)
}

// Only the author may flip the privacy toggle — admins cannot force-hide or
// force-share someone else's note without them knowing.
export function canTogglePrivate(
  user: SessionUser,
  note: Pick<Note, 'instanceId' | 'authorId'>,
): boolean {
  return isSameInstance(user, note) && note.authorId === user.id
}

export function canCreateNote(user: SessionUser): boolean {
  return user.role !== 'read_only'
}
