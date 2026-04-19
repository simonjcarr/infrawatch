'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Lock, Eye } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import {
  createNote,
  updateNote,
  toggleNotePrivate,
} from '@/lib/actions/notes'
import { getNoteTemplate } from '@/lib/notes/templates'
import { NOTE_CATEGORIES, type NoteCategory } from '@/lib/db/schema'

interface NewNoteProps {
  mode: 'create'
  orgId: string
  hostId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface EditNoteProps {
  mode: 'edit'
  orgId: string
  hostId: string
  noteId: string
  initial: {
    title: string
    body: string
    category: NoteCategory
    isPrivate: boolean
    isAuthor: boolean
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Props = NewNoteProps | EditNoteProps

const CATEGORY_LABELS: Record<NoteCategory, string> = {
  general: 'General',
  runbook: 'Runbook',
  'known-issue': 'Known issue',
  fix: 'Fix',
  contact: 'Contact',
  workaround: 'Workaround',
}

export function NoteEditorDialog(props: Props) {
  const { mode, orgId, hostId, open, onOpenChange } = props
  const queryClient = useQueryClient()

  const initial = useMemo(
    () =>
      mode === 'edit'
        ? props.initial
        : { title: '', body: '', category: 'general' as NoteCategory, isPrivate: false, isAuthor: true },
    [mode, mode === 'edit' ? props.initial : null], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Callers mount the dialog conditionally (`{editOpen && <NoteEditorDialog …>}`
  // and `{createOpen && <NoteEditorDialog …>}`), so these initial values are
  // always fresh on mount — no extra reset-on-open effect needed.
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [category, setCategory] = useState<NoteCategory>(initial.category)
  const [isPrivate, setIsPrivate] = useState(initial.isPrivate)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // On create, switching category seeds the body template. Only seed when the
  // body is empty so we never overwrite something the user has already typed.
  function handleCategoryChange(next: NoteCategory) {
    setCategory(next)
    if (mode === 'create' && body.trim().length === 0) {
      setBody(getNoteTemplate(next).body)
    }
  }

  const invalidateHostNotes = () => {
    queryClient.invalidateQueries({ queryKey: ['notes-for-host', orgId, hostId] })
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const result = await createNote(orgId, {
        title: title.trim(),
        body,
        category,
        isPrivate,
        targets: [{ targetType: 'host', targetId: hostId, isPinned: false }],
      })
      if ('error' in result) throw new Error(result.error)
      return result.note
    },
    onSuccess: () => {
      invalidateHostNotes()
      onOpenChange(false)
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (mode !== 'edit') throw new Error('wrong mode')
      const result = await updateNote(orgId, props.noteId, {
        title: title.trim(),
        body,
        category,
      })
      if ('error' in result) throw new Error(result.error)

      // Privacy is author-only; skip the call if the flag didn't change or the
      // user isn't the author (admins don't see the toggle at all).
      if (props.initial.isAuthor && props.initial.isPrivate !== isPrivate) {
        const privacyResult = await toggleNotePrivate(orgId, props.noteId, isPrivate)
        if ('error' in privacyResult) throw new Error(privacyResult.error)
      }
      return result.note
    },
    onSuccess: () => {
      invalidateHostNotes()
      if (mode === 'edit') {
        queryClient.invalidateQueries({ queryKey: ['note-revisions', orgId, props.noteId] })
      }
      onOpenChange(false)
    },
    onError: (err: Error) => setError(err.message),
  })

  const isSaving = createMutation.isPending || updateMutation.isPending
  const canSave = title.trim().length > 0 && !isSaving

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (mode === 'create') createMutation.mutate()
    else updateMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New note' : 'Edit note'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="note-title">Title</Label>
            <Input
              id="note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. nginx restart procedure"
              maxLength={200}
              autoFocus
              disabled={isSaving}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(v) => handleCategoryChange(v as NoteCategory)}
                disabled={isSaving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(mode === 'create' || (mode === 'edit' && props.initial.isAuthor)) && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-2">Visibility</Label>
                <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-transparent">
                  <Switch
                    id="note-private"
                    checked={isPrivate}
                    onCheckedChange={setIsPrivate}
                    disabled={isSaving}
                  />
                  <Label
                    htmlFor="note-private"
                    className="text-sm cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {isPrivate ? (
                      <>
                        <Lock className="size-3.5" />
                        Private
                      </>
                    ) : (
                      <>
                        <Eye className="size-3.5" />
                        Shared
                      </>
                    )}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isPrivate
                    ? 'Only you and super admins can read this note.'
                    : 'Everyone in your org who can see this host.'}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="note-body">Body</Label>
              <div className="flex gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setPreview(false)}
                  className={`px-2 py-0.5 rounded ${
                    !preview ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Write
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(true)}
                  className={`px-2 py-0.5 rounded ${
                    preview ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Preview
                </button>
              </div>
            </div>
            {preview ? (
              <div className="min-h-48 max-h-[28rem] overflow-y-auto rounded-md border border-input bg-transparent px-3 py-2">
                {body.trim().length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Nothing to preview yet.</p>
                ) : (
                  <MarkdownRenderer>{body}</MarkdownRenderer>
                )}
              </div>
            ) : (
              <Textarea
                id="note-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="min-h-48 max-h-[28rem] font-mono text-sm"
                placeholder="Markdown supported — GitHub flavor. Raw HTML is stripped."
                maxLength={50_000}
                disabled={isSaving}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Markdown renders with GitHub flavor. HTML is stripped for safety.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isSaving ? (
                <>
                  <Loader2 className="size-4 mr-1 animate-spin" />
                  Saving…
                </>
              ) : mode === 'create' ? (
                'Create note'
              ) : (
                'Save changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
