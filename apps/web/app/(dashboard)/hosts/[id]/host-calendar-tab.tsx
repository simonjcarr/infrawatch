'use client'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CalendarDays, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

function HostCalendarEventRow({ event }: { event: HostCalendarEventView }) {
  return (
    <TableRow data-testid={`host-calendar-event-${safeTestId(event.id)}`}>
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
  const { data, isLoading, error } = useQuery({
    queryKey: ['host-calendar-events', scopeId, hostId],
    queryFn: () => listCalendarEventsForHost(scopeId, hostId),
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
                <HostCalendarEventRow key={event.id} event={event} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
