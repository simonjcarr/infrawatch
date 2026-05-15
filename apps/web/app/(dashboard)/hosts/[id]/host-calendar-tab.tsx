'use client'

import { useQuery } from '@tanstack/react-query'
import { format, isSameDay, isToday, isTomorrow } from 'date-fns'
import { CalendarDays, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { listCalendarEventsForHost, type HostCalendarEventView } from '@/lib/actions/calendar'
import {
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_EVENT_STATUSES,
  type CalendarParticipantRole,
  type CalendarEventCategory,
  type CalendarEventStatus,
} from '@/lib/db/schema/calendar'

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

const PARTICIPANT_ROLE_LABELS: Record<CalendarParticipantRole, string> = {
  owner: 'Owner',
  requester: 'Requester',
  implementer: 'Implementer',
  approver: 'Approver',
  reviewer: 'Reviewer',
  observer: 'Observer',
}

const HOST_CALENDAR_REFETCH_INTERVAL_MS = 5_000
const EMPTY_HOST_CALENDAR_EVENTS: HostCalendarEventView[] = []
type CategoryFilter = CalendarEventCategory | 'all'
type StatusFilter = CalendarEventStatus | 'all'
type DateLabel = {
  text: string
  isRelative: boolean
}
type FormattedEventDate = {
  text: string
  title?: string
}

function safeTestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function formatDateLabel(date: Date): DateLabel {
  if (isToday(date)) return { text: 'Today', isRelative: true }
  if (isTomorrow(date)) return { text: 'Tomorrow', isRelative: true }
  return { text: format(date, 'd MMM yyyy'), isRelative: false }
}

function formatAbsoluteDate(date: Date): string {
  return format(date, 'd MMM yyyy')
}

function formatAbsoluteDateTime(date: Date): string {
  return format(date, 'd MMM yyyy, HH:mm')
}

function isPastEvent(event: HostCalendarEventView): boolean {
  return new Date(event.endsAt).getTime() < Date.now()
}

function formatEventDate(event: HostCalendarEventView): FormattedEventDate {
  const startsAt = new Date(event.startsAt)
  const endsAt = new Date(event.endsAt)
  const startLabel = formatDateLabel(startsAt)
  const endLabel = formatDateLabel(endsAt)
  const usesRelativeDate = startLabel.isRelative || endLabel.isRelative
  if (event.allDay) {
    const text = isSameDay(startsAt, endsAt)
      ? startLabel.text
      : `${startLabel.text} - ${endLabel.text}`
    const title = usesRelativeDate
      ? isSameDay(startsAt, endsAt)
        ? formatAbsoluteDate(startsAt)
        : `${formatAbsoluteDate(startsAt)} - ${formatAbsoluteDate(endsAt)}`
      : undefined
    return { text, title }
  }
  if (isSameDay(startsAt, endsAt)) {
    return {
      text: `${startLabel.text}, ${format(startsAt, 'HH:mm')} - ${format(endsAt, 'HH:mm')}`,
      title: usesRelativeDate ? `${formatAbsoluteDateTime(startsAt)} - ${formatAbsoluteDateTime(endsAt)}` : undefined,
    }
  }
  return {
    text: `${startLabel.text}, ${format(startsAt, 'HH:mm')} - ${endLabel.text}, ${format(endsAt, 'HH:mm')}`,
    title: usesRelativeDate ? `${formatAbsoluteDateTime(startsAt)} - ${formatAbsoluteDateTime(endsAt)}` : undefined,
  }
}

function formatEventDateRange(event: HostCalendarEventView): FormattedEventDate {
  const startsAt = new Date(event.startsAt)
  const endsAt = new Date(event.endsAt)
  const startLabel = formatDateLabel(startsAt)
  const endLabel = formatDateLabel(endsAt)
  const usesRelativeDate = startLabel.isRelative || endLabel.isRelative
  if (event.allDay) {
    return {
      text: `${startLabel.text} - ${endLabel.text}`,
      title: usesRelativeDate ? `${formatAbsoluteDate(startsAt)} - ${formatAbsoluteDate(endsAt)}` : undefined,
    }
  }
  return {
    text: `${startLabel.text}, ${format(startsAt, 'HH:mm')} - ${endLabel.text}, ${format(endsAt, 'HH:mm')}`,
    title: usesRelativeDate ? `${formatAbsoluteDateTime(startsAt)} - ${formatAbsoluteDateTime(endsAt)}` : undefined,
  }
}

function EventDateText({
  value,
  testId,
}: {
  value: FormattedEventDate
  testId: string
}) {
  return (
    <span data-testid={testId} title={value.title}>
      {value.text}
    </span>
  )
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
  hostId,
  onOpenChange,
}: {
  event: HostCalendarEventView | null
  hostId: string
  onOpenChange: (open: boolean) => void
}) {
  const formattedDateRange = event ? formatEventDateRange(event) : null

  return (
    <Dialog open={event != null} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] grid-rows-none flex-col overflow-hidden sm:max-w-3xl lg:max-w-4xl"
        data-testid="host-calendar-event-dialog"
      >
        {event ? (
          <>
            <DialogHeader className="shrink-0">
              <div className="flex flex-wrap items-center gap-2 pr-8">
                <DialogTitle>{event.title}</DialogTitle>
                <Badge variant="outline" className={STATUS_BADGE_CLASS[event.status]}>
                  {STATUS_LABELS[event.status]}
                </Badge>
              </div>
              <DialogDescription>{CATEGORY_LABELS[event.category]} event</DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="details" className="min-h-0 flex-1 overflow-hidden">
              <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
                <TabsTrigger value="details">Activity Detail</TabsTrigger>
                <TabsTrigger value="hosts">Hosts</TabsTrigger>
                <TabsTrigger value="participants">Participants</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="min-h-0 space-y-5 overflow-y-auto pt-2">
                <div
                  className="max-h-[min(22rem,45vh)] overflow-y-auto rounded-md border bg-background p-4"
                  data-testid="host-calendar-event-description"
                >
                  {event.description ? (
                    <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                      {event.description}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No description provided.</p>
                  )}
                </div>

                <dl className="grid gap-4 sm:grid-cols-2">
                  <EventDetail label="Date and time">
                    {formattedDateRange ? (
                      <EventDateText value={formattedDateRange} testId="host-calendar-event-detail-date" />
                    ) : null}
                  </EventDetail>
                  <EventDetail label="Timezone">{event.timezone}</EventDetail>
                  <EventDetail label="Status">{STATUS_LABELS[event.status]}</EventDetail>
                  <EventDetail label="Category">{CATEGORY_LABELS[event.category]}</EventDetail>
                  <EventDetail label="Schedule">
                    {event.isRecurring ? 'Recurring' : 'One-off'}
                  </EventDetail>
                  <EventDetail label="All day">{event.allDay ? 'Yes' : 'No'}</EventDetail>
                </dl>
              </TabsContent>

              <TabsContent
                value="hosts"
                className="min-h-0 overflow-y-auto pt-2"
                data-testid="host-calendar-event-hosts-tab"
              >
                {event.hosts.length === 0 ? (
                  <p className="rounded-md border bg-background p-4 text-sm text-muted-foreground">
                    No hosts are linked to this activity.
                  </p>
                ) : (
                  <div className="divide-y overflow-hidden rounded-md border bg-background">
                    {event.hosts.map((host) => {
                      const isCurrentHost = host.id === hostId
                      return (
                        <div key={host.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground">
                                {host.displayName || host.hostname}
                              </span>
                              {isCurrentHost ? (
                                <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/10">
                                  Current host
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 break-all text-sm text-muted-foreground">{host.hostname}</p>
                          </div>
                          {host.os ? (
                            <Badge variant="secondary" className="w-fit">{host.os}</Badge>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent
                value="participants"
                className="min-h-0 overflow-y-auto pt-2"
                data-testid="host-calendar-event-participants-tab"
              >
                {event.participants.length === 0 ? (
                  <p className="rounded-md border bg-background p-4 text-sm text-muted-foreground">
                    No participants are linked to this activity.
                  </p>
                ) : (
                  <div className="divide-y overflow-hidden rounded-md border bg-background">
                    {event.participants.map((participant) => (
                      <div key={participant.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{participant.name || participant.email}</p>
                          <p className="mt-1 break-all text-sm text-muted-foreground">{participant.email}</p>
                        </div>
                        <Badge variant="outline" className="w-fit">
                          {PARTICIPANT_ROLE_LABELS[participant.participantRole]}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
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
  const past = isPastEvent(event)
  const formattedDate = formatEventDate(event)

  return (
    <TableRow
      aria-label={`View details for ${event.title}`}
      className={`cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${past ? 'bg-muted/30 text-muted-foreground' : ''} ${event.isLinkedToCurrentUser ? 'border-l-4 border-l-primary' : ''}`}
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
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-medium ${past ? 'text-muted-foreground' : 'text-foreground'}`}>{event.title}</span>
          {event.isLinkedToCurrentUser ? (
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/10">
              Linked to you
            </Badge>
          ) : null}
          {past ? (
            <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-100">
              Past
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        <EventDateText value={formattedDate} testId="host-calendar-event-date" />
      </TableCell>
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
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const { data, isLoading, error } = useQuery({
    queryKey: ['host-calendar-events', scopeId, hostId],
    queryFn: () => listCalendarEventsForHost(scopeId, hostId),
    refetchInterval: HOST_CALENDAR_REFETCH_INTERVAL_MS,
  })

  const events = data && !('error' in data) ? data.events : EMPTY_HOST_CALENDAR_EVENTS
  const filteredEvents = useMemo(
    () => events.filter((event) => (
      (categoryFilter === 'all' || event.category === categoryFilter) &&
      (statusFilter === 'all' || event.status === statusFilter)
    )),
    [categoryFilter, events, statusFilter],
  )
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
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="host-calendar-category-filter">Category</Label>
                <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as CategoryFilter)}>
                  <SelectTrigger id="host-calendar-category-filter" className="w-44" data-testid="host-calendar-category-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {CALENDAR_EVENT_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {CATEGORY_LABELS[category]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="host-calendar-status-filter">Status</Label>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                  <SelectTrigger id="host-calendar-status-filter" className="w-40" data-testid="host-calendar-status-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {CALENDAR_EVENT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {filteredEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No calendar events match these filters.</p>
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
                  {filteredEvents.map((event) => (
                    <HostCalendarEventRow key={event.id} event={event} onSelect={setSelectedEvent} />
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
      <HostCalendarEventDetailsDialog
        event={selectedEvent}
        hostId={hostId}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null)
        }}
      />
    </Card>
  )
}
