'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Filter, Loader2, NotebookPen, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { deleteNote, listNotesForHost } from '@/lib/actions/notes'
import type { ResolvedNote } from '@/lib/actions/notes-resolver'
import { NOTE_CATEGORIES, type NoteCategory } from '@/lib/db/schema'
import { NoteEditorDialog } from './note-editor-dialog'

const CATEGORY_LABELS: Record<NoteCategory, string> = {
  general: 'General',
  runbook: 'Runbook',
  'known-issue': 'Known issue',
  fix: 'Fix',
  contact: 'Contact',
  workaround: 'Workaround',
}

interface Props {
  hostId: string
  currentUserId: string
  userRole: string
}

export function NotesTab({ hostId, currentUserId, userRole }: Props) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedNote, setSelectedNote] = useState<ResolvedNote | null>(null)
  const [editingNote, setEditingNote] = useState<ResolvedNote | null>(null)
  const [deletingNote, setDeletingNote] = useState<ResolvedNote | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<NoteCategory | 'all'>('all')
  const [actionError, setActionError] = useState<string | null>(null)

  const canCreate = userRole !== 'read_only'

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['notes-for-host', hostId],
    queryFn: () => listNotesForHost(hostId),
  })

  const invalidateHostNotes = () => {
    queryClient.invalidateQueries({ queryKey: ['notes-for-host', hostId] })
  }

  const deleteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const result = await deleteNote(noteId)
      if ('error' in result) throw new Error(result.error)
    },
    onSuccess: () => {
      setDeletingNote(null)
      setSelectedNote(null)
      invalidateHostNotes()
    },
    onError: (err: Error) => setActionError(err.message),
  })

  // Counts per category drive badge tags so empty categories don't clutter the
  // filter row. Derived from the full list, not the filtered one.
  const countsByCategory = useMemo(() => {
    const out: Record<NoteCategory, number> = {
      general: 0,
      runbook: 0,
      'known-issue': 0,
      fix: 0,
      contact: 0,
      workaround: 0,
    }
    for (const n of notes) out[n.category] += 1
    return out
  }, [notes])

  const visibleNotes = useMemo(
    () =>
      categoryFilter === 'all'
        ? notes
        : notes.filter((n) => n.category === categoryFilter),
    [notes, categoryFilter],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            Notes attached directly, via a host group, or via a matching tag selector.
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1" />
            New note
          </Button>
        )}
      </div>

      {notes.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Filter className="size-3" />
            Filter
          </span>
          <FilterPill
            active={categoryFilter === 'all'}
            onClick={() => setCategoryFilter('all')}
            count={notes.length}
          >
            All
          </FilterPill>
          {NOTE_CATEGORIES.map((c) => {
            const count = countsByCategory[c]
            if (count === 0) return null
            return (
              <FilterPill
                key={c}
                active={categoryFilter === c}
                onClick={() => setCategoryFilter(c)}
                count={count}
              >
                {CATEGORY_LABELS[c]}
              </FilterPill>
            )
          })}
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Loading notes…
          </CardContent>
        </Card>
      ) : notes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <NotebookPen className="size-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">No notes yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Capture a runbook, a known issue, or a contact for this host. Notes are
            shared across this CT-Ops instance unless you mark them private.
          </p>
          {canCreate && (
            <Button className="mt-4" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4 mr-1" />
              New note
            </Button>
          )}
        </div>
      ) : visibleNotes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No notes in this category.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-24 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleNotes.map((note) => {
                const isAuthor = note.authorId === currentUserId
                const isAdmin = userRole === 'super_admin' || userRole === 'org_admin'
                const canManage =
                  !note.deletedAt && userRole !== 'read_only' && (isAuthor || isAdmin)

                return (
                  <TableRow key={note.id}>
                    <TableCell className="max-w-[22rem]">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        onClick={() => setSelectedNote(note)}
                      >
                        {note.title}
                      </button>
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate text-muted-foreground">
                      {note.authorName ?? 'Unknown'}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground"
                      title={new Date(note.updatedAt).toLocaleString()}
                    >
                      {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <div className="inline-flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setEditingNote(note)}
                            aria-label={`Edit ${note.title}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeletingNote(note)}
                            aria-label={`Delete ${note.title}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {actionError && (
        <div role="alert" className="text-sm text-destructive">
          {actionError}
        </div>
      )}

      {createOpen && (
        <NoteEditorDialog
          mode="create"
          hostId={hostId}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}

      {editingNote && (
        <NoteEditorDialog
          mode="edit"
          hostId={hostId}
          noteId={editingNote.id}
          initial={{
            title: editingNote.title,
            body: editingNote.body,
            category: editingNote.category,
            isPrivate: editingNote.isPrivate,
            isAuthor: editingNote.authorId === currentUserId,
          }}
          open={editingNote != null}
          onOpenChange={(open) => {
            if (!open) setEditingNote(null)
          }}
        />
      )}

      <Dialog open={selectedNote != null} onOpenChange={(open) => !open && setSelectedNote(null)}>
        <DialogContent className="max-w-3xl">
          {selectedNote && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedNote.title}</DialogTitle>
                <DialogDescription>
                  By {selectedNote.authorName ?? 'Unknown'} ·{' '}
                  {new Date(selectedNote.updatedAt).toLocaleString()}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[65vh] overflow-y-auto rounded-md border bg-background p-4">
                {selectedNote.body.trim().length > 0 ? (
                  <MarkdownRenderer>{selectedNote.body}</MarkdownRenderer>
                ) : (
                  <p className="text-sm text-muted-foreground">This note has no body.</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletingNote != null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeletingNote(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deletingNote?.title}</strong>? It disappears from every list,
              but the revision history is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteMutation.isPending || deletingNote == null}
              onClick={(e) => {
                e.preventDefault()
                if (deletingNote) deleteMutation.mutate(deletingNote.id)
              }}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="size-4 mr-1 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function FilterPill({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background text-muted-foreground border-border hover:text-foreground'
      }`}
    >
      {children}
      <Badge
        className={`px-1.5 py-0 ${
          active
            ? 'bg-primary-foreground/20 text-primary-foreground border-transparent hover:bg-primary-foreground/20'
            : 'bg-muted text-muted-foreground border-transparent hover:bg-muted'
        }`}
      >
        {count}
      </Badge>
    </button>
  )
}
