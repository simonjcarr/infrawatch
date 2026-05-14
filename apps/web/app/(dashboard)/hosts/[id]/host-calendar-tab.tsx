'use client'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CalendarDays, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { listCalendarEventsForHost, type HostCalendarEventView } from '@/lib/actions/calendar'
import type { CalendarEventCategory, CalendarEventStatus } from '@/lib/db/schema/calendar'

const CATEGORY_LABELS: Record<CalendarEventCategory, string> = {
  maintenance: 'Maintenance',
  patching: 'Patching',
  application: 'Application',
  change: 'Change',
  meeting: 'Meeting',
  other: 'Other',
}

const STATUS_LABELS: Record<CalendarEventStatus, string> = {
  planned: 'Planned',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const STATUS_BADGE_CLASS: Record<CalendarEventStatus, string> = {
  planned: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100',
  confirmed: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100',
  in_progress: 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100',
  completed: 'bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-100',
  cancelled: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100',
}
const HOST_CALENDAR_REFETCH_INTERVAL_MS = 5_000

function safeTestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function formatEventDate(event: HostCalendarEventView): string {
  const startsAt = new Date(event.startsAt)
  const endsAt = new Date(event.endsAt)
  if (event.allDay) {
    return format(startsAt, 'd MMM yyyy')
  }
  return `${format(startsAt, 'd MMM yyyy, HH:mm')} - ${format(endsAt, 'HH:mm')}`
}

function formatEventDateRange(event: HostCalendarEventView): string {
  const startsAt = new Date(event.startsAt)
  const endsAt = new Date(event.endsAt)
  if (event.allDay) {
    return `${format(startsAt, 'd MMM yyyy')} - ${format(endsAt, 'd MMM yyyy')}`
  }
  return `${format(startsAt, 'd MMM yyyy, HH:mm')} - ${format(endsAt, 'd MMM yyyy, HH:mm')}`
}

function EventDetail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

function HostCalendarEventDetailsDialog({
  event,
  onOpenChange,
}: {
  event: HostCalendarEventView | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={event != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="host-calendar-event-dialog">
        {event ? (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-8">
                <DialogTitle>{event.title}</DialogTitle>
                <Badge variant="outline" className={STATUS_BADGE_CLASS[event.status]}>
                  {STATUS_LABELS[event.status]}
                </Badge>
              </div>
              <DialogDescription>{CATEGORY_LABELS[event.category]} event</DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div className="rounded-md border bg-background p-4">
                {event.description ? (
                  <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                    {event.description}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No description provided.</p>
                )}
              </div>

              <dl className="grid gap-4 sm:grid-cols-2">
                <EventDetail label="Date and time">{formatEventDateRange(event)}</EventDetail>
                <EventDetail label="Timezone">{event.timezone}</EventDetail>
                <EventDetail label="Status">{STATUS_LABELS[event.status]}</EventDetail>
                <EventDetail label="Category">{CATEGORY_LABELS[event.category]}</EventDetail>
                <EventDetail label="Schedule">
                  {event.isRecurring ? 'Recurring' : 'One-off'}
                </EventDetail>
                <EventDetail label="All day">{event.allDay ? 'Yes' : 'No'}</EventDetail>
              </dl>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function HostCalendarEventRow({
  event,
  onSelect,
}: {
  event: HostCalendarEventView
  onSelect: (event: HostCalendarEventView) => void
}) {
  const openDetails = () => onSelect(event)

  return (
    <TableRow
      aria-label={`View details for ${event.title}`}
      className="cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      data-testid={`host-calendar-event-${safeTestId(event.id)}`}
      onClick={openDetails}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openDetails()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <TableCell>
        <div className="space-y-1">
          <div className="font-medium text-foreground">{event.title}</div>
          {event.description ? (
            <div className="line-clamp-2 text-xs text-muted-foreground">{event.description}</div>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">{formatEventDate(event)}</TableCell>
      <TableCell>
        <Badge variant="outline" className={STATUS_BADGE_CLASS[event.status]}>
          {STATUS_LABELS[event.status]}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{CATEGORY_LABELS[event.category]}</Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {event.isRecurring ? 'Recurring' : 'One-off'}
      </TableCell>
    </TableRow>
  )
}

export function HostCalendarTab({ scopeId, hostId }: { scopeId: string; hostId: string }) {
  const [selectedEvent, setSelectedEvent] = useState<HostCalendarEventView | null>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['host-calendar-events', scopeId, hostId],
    queryFn: () => listCalendarEventsForHost(scopeId, hostId),
    refetchInterval: HOST_CALENDAR_REFETCH_INTERVAL_MS,
  })

  const events = data && !('error' in data) ? data.events : []
  const errorMessage = data && 'error' in data ? data.error : error instanceof Error ? error.message : null

  return (
    <Card data-testid="host-calendar-tab">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="size-5" />
          Calendar
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading calendar events...
          </div>
        ) : errorMessage ? (
          <p className="text-sm text-destructive">{errorMessage}</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calendar events linked to this host.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Date and time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Schedule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <HostCalendarEventRow key={event.id} event={event} onSelect={setSelectedEvent} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <HostCalendarEventDetailsDialog
        event={selectedEvent}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null)
        }}
      />
    </Card>
  )
}
