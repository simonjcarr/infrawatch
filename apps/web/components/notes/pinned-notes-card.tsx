'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pin } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listNotesForHost } from '@/lib/actions/notes'
import { NoteCard } from './note-card'

interface Props {
  orgId: string
  hostId: string
  currentUserId: string
  userRole: string
  // Notified when the user clicks "view all notes" so the parent can switch
  // tabs without this component having to know about the tab state machine.
  onViewAll?: () => void
}

// Overview-tab card. Renders only pinned notes — quiet when there are none so
// the Overview doesn't carry an empty section. Cards render in compact mode
// (collapsed body) so a pin'd runbook doesn't push metrics off the fold.
export function PinnedNotesCard({
  orgId,
  hostId,
  currentUserId,
  userRole,
  onViewAll,
}: Props) {
  const { data: notes = [] } = useQuery({
    queryKey: ['notes-for-host', orgId, hostId],
    queryFn: () => listNotesForHost(orgId, hostId),
  })

  const pinned = useMemo(() => notes.filter((n) => n.isPinned), [notes])

  if (pinned.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Pin className="size-4 text-amber-600" />
            Pinned notes
            <span className="text-xs font-normal text-muted-foreground">({pinned.length})</span>
          </CardTitle>
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="text-xs font-medium text-primary hover:underline"
            >
              View all notes
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {pinned.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            orgId={orgId}
            hostId={hostId}
            currentUserId={currentUserId}
            userRole={userRole}
            compact
          />
        ))}
      </CardContent>
    </Card>
  )
}
