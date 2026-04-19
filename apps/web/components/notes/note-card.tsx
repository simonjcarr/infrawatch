'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  Pin,
  PinOff,
  Lock,
  MoreVertical,
  Pencil,
  Trash2,
  Loader2,
  Users,
  Tag,
  User,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { NoteEditorDialog } from './note-editor-dialog'
import {
  toggleNotePin,
  deleteNote,
} from '@/lib/actions/notes'
import type { ResolvedNote, ResolvedNoteSource } from '@/lib/actions/notes-resolver'
import type { NoteCategory } from '@/lib/db/schema'

const CATEGORY_LABELS: Record<NoteCategory, string> = {
  general: 'General',
  runbook: 'Runbook',
  'known-issue': 'Known issue',
  fix: 'Fix',
  contact: 'Contact',
  workaround: 'Workaround',
}

// Soft-coloured badges — muted enough not to compete with real status signals
// on the page (alerts, host state) but distinct enough to scan categories at a
// glance.
const CATEGORY_STYLES: Record<NoteCategory, string> = {
  general: 'bg-slate-100 text-slate-700 border-slate-200',
  runbook: 'bg-blue-100 text-blue-800 border-blue-200',
  'known-issue': 'bg-amber-100 text-amber-800 border-amber-200',
  fix: 'bg-green-100 text-green-800 border-green-200',
  contact: 'bg-purple-100 text-purple-800 border-purple-200',
  workaround: 'bg-orange-100 text-orange-800 border-orange-200',
}

const SOURCE_LABELS: Record<ResolvedNoteSource, { label: string; icon: typeof User }> = {
  direct: { label: 'Pinned to host', icon: User },
  group: { label: 'Via group', icon: Users },
  tag_selector: { label: 'Via tag', icon: Tag },
}

interface Props {
  note: ResolvedNote
  orgId: string
  hostId: string
  currentUserId: string
  userRole: string
  // When true, body collapses after a few lines with a "Show more" toggle —
  // used on the Overview pinned-card where cards need to stay scannable.
  compact?: boolean
}

export function NoteCard({
  note,
  orgId,
  hostId,
  currentUserId,
  userRole,
  compact = false,
}: Props) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(!compact)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const isAuthor = note.authorId === currentUserId
  const isAdmin = userRole === 'super_admin' || userRole === 'org_admin'
  const canEdit = !note.deletedAt && userRole !== 'read_only' && (isAuthor || isAdmin)
  const canDelete = canEdit
  const canPin = note.directTargetId != null && canEdit

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notes-for-host', orgId, hostId] })
  }

  const pinMutation = useMutation({
    mutationFn: async () => {
      if (!note.directTargetId) throw new Error('Cannot pin — not directly targeted to this host')
      const result = await toggleNotePin(orgId, note.directTargetId, !note.isPinned)
      if ('error' in result) throw new Error(result.error)
    },
    onSuccess: invalidate,
    onError: (err: Error) => setActionError(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const result = await deleteNote(orgId, note.id)
      if ('error' in result) throw new Error(result.error)
    },
    onSuccess: () => {
      setDeleteOpen(false)
      invalidate()
    },
    onError: (err: Error) => setActionError(err.message),
  })

  const bodyIsLong = note.body.length > 400 || note.body.split('\n').length > 8
  const renderedBody =
    compact && !expanded && bodyIsLong ? truncateMarkdown(note.body, 400) : note.body

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-foreground truncate">{note.title}</h3>
              {note.isPinned && (
                <Badge
                  className="bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-50"
                  title="Pinned to this host's overview"
                >
                  <Pin className="size-3 mr-1" />
                  Pinned
                </Badge>
              )}
              {note.isPrivate && (
                <Badge className="bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100">
                  <Lock className="size-3 mr-1" />
                  Private
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <Badge className={`${CATEGORY_STYLES[note.category]} hover:${CATEGORY_STYLES[note.category]}`}>
                {CATEGORY_LABELS[note.category]}
              </Badge>
              {note.sources.map((source) => {
                const { label, icon: Icon } = SOURCE_LABELS[source]
                return (
                  <span key={source} className="inline-flex items-center gap-1">
                    <Icon className="size-3" />
                    {label}
                  </span>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {canPin ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={pinMutation.isPending}
                      onClick={() => pinMutation.mutate()}
                    >
                      {pinMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : note.isPinned ? (
                        <PinOff className="size-4 text-amber-600" />
                      ) : (
                        <Pin className="size-4 text-muted-foreground" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {note.isPinned ? 'Unpin from overview' : 'Pin to overview'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}

            {(canEdit || canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8">
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && (
                    <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                      <Pencil className="size-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {canEdit && canDelete && <DropdownMenuSeparator />}
                  {canDelete && (
                    <DropdownMenuItem
                      onSelect={() => setDeleteOpen(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="size-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {note.body.trim().length > 0 && (
          <div>
            <MarkdownRenderer>{renderedBody}</MarkdownRenderer>
            {compact && bodyIsLong && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 text-xs font-medium text-primary hover:underline"
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground pt-1 border-t">
          <span className="truncate">
            By {note.authorName ?? 'Unknown'}
            {note.lastEditedByName && note.lastEditedByName !== note.authorName && (
              <> · edited by {note.lastEditedByName}</>
            )}
          </span>
          <span className="shrink-0" title={new Date(note.updatedAt).toLocaleString()}>
            {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
          </span>
        </div>

        {actionError && (
          <div role="alert" className="text-xs text-destructive">
            {actionError}
          </div>
        )}
      </CardContent>

      {editOpen && (
        <NoteEditorDialog
          mode="edit"
          orgId={orgId}
          hostId={hostId}
          noteId={note.id}
          initial={{
            title: note.title,
            body: note.body,
            category: note.category,
            isPrivate: note.isPrivate,
            isAuthor,
          }}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{note.title}</strong>? It disappears from every list,
              but the revision history is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                deleteMutation.mutate()
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
    </Card>
  )
}

// Trim markdown to a rough character budget while preferring to break at a
// line boundary so we don't chop inside a code block or list item. Not
// exhaustive — the compact card's "Show more" reveals the full body anyway.
function truncateMarkdown(body: string, budget: number): string {
  if (body.length <= budget) return body
  const truncated = body.slice(0, budget)
  const lastNewline = truncated.lastIndexOf('\n')
  return (lastNewline > budget / 2 ? truncated.slice(0, lastNewline) : truncated) + '\n\n…'
}
