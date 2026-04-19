'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NotebookPen, Plus, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { listNotesForHost } from '@/lib/actions/notes'
import { NOTE_CATEGORIES, type NoteCategory } from '@/lib/db/schema'
import { NoteCard } from './note-card'
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
  orgId: string
  hostId: string
  currentUserId: string
  userRole: string
}

export function NotesTab({ orgId, hostId, currentUserId, userRole }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<NoteCategory | 'all'>('all')

  const canCreate = userRole !== 'read_only'

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['notes-for-host', orgId, hostId],
    queryFn: () => listNotesForHost(orgId, hostId),
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
            shared with your org unless you mark them private.
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
        <div className="space-y-3">
          {visibleNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              orgId={orgId}
              hostId={hostId}
              currentUserId={currentUserId}
              userRole={userRole}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <NoteEditorDialog
          mode="create"
          orgId={orgId}
          hostId={hostId}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
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
