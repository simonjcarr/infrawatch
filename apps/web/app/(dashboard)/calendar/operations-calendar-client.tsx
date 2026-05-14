'use client'

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  moveCalendarEventInstance,
  searchCalendarHosts,
  searchCalendarUsers,
  updateCalendarEvent,
  type CalendarEventInstanceView,
  type CalendarHostOption,
  type CalendarUserOption,
} from '@/lib/actions/calendar'
import { getTimedEventLayouts } from '@/lib/calendar/timed-layout'
import {
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_EVENT_STATUSES,
  CALENDAR_PARTICIPANT_ROLES,
  CALENDAR_WEEKDAYS,
  type CalendarEventCategory,
  type CalendarEventStatus,
  type CalendarParticipantRole,
  type CalendarRecurrenceFrequency,
  type CalendarRecurrenceRule,
  type CalendarWeekday,
} from '@/lib/db/schema/calendar'

type CalendarViewId = 'day' | 'work-week' | 'full-week' | 'month' | 'year'
type TimeViewId = Extract<CalendarViewId, 'day' | 'work-week' | 'full-week'>
type DialogMode = 'create' | 'edit'
type RecurrenceFrequencyDraft = 'none' | CalendarRecurrenceFrequency
type RecurrenceEndMode = 'never' | 'count' | 'until'

interface CalendarRange {
  startsAt: string
  endsAt: string
}

interface EventDraft {
  eventId: string | null
  recurrenceInstanceStartAt: string | null
  mode: DialogMode
  title: string
  description: string
  startsAt: string
  endsAt: string
  allDay: boolean
  timezone: string
  status: CalendarEventStatus
  category: CalendarEventCategory
  recurrenceFrequency: RecurrenceFrequencyDraft
  recurrenceInterval: string
  recurrenceWeekdays: CalendarWeekday[]
  recurrenceEndMode: RecurrenceEndMode
  recurrenceCount: string
  recurrenceUntil: string
  hostIds: string[]
  participants: Array<{ userId: string; role: CalendarParticipantRole }>
}

declare global {
  interface Window {
    __ctOpsCalendarTestMoveEvent?: (input: {
      eventId: string
      recurrenceInstanceStartAt?: string
      startsAt: string
      endsAt: string
      scope: 'this' | 'series'
    }) => Promise<void>
  }
}

const VIEW_OPTIONS: Array<{ id: CalendarViewId; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'work-week', label: 'Work Week' },
  { id: 'full-week', label: 'Full Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

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

const PARTICIPANT_ROLE_LABELS: Record<CalendarParticipantRole, string> = {
  owner: 'Owner',
  requester: 'Requester',
  implementer: 'Implementer',
  approver: 'Approver',
  reviewer: 'Reviewer',
  observer: 'Observer',
}

const WEEKDAY_LABELS: Record<CalendarWeekday, string> = {
  mo: 'Mon',
  tu: 'Tue',
  we: 'Wed',
  th: 'Thu',
  fr: 'Fri',
  sa: 'Sat',
  su: 'Sun',
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const TIME_SLOT_MINUTES = 30
const TIME_SLOT_COUNT = 24 * (60 / TIME_SLOT_MINUTES)
const WORKDAY_SCROLL_SLOT = 9 * (60 / TIME_SLOT_MINUTES)
const TIME_SLOTS = Array.from({ length: TIME_SLOT_COUNT }, (_, index) => index * TIME_SLOT_MINUTES)

function formatMonthYear(date: Date): string {
  return `${MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`
}

function formatDayMonthYear(date: Date): string {
  return `${date.getDate()} ${MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`
}

function startOfWeekMonday(date: Date): Date {
  const start = new Date(date)
  const day = start.getDay()
  const offset = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + offset)
  start.setHours(0, 0, 0, 0)
  return start
}

function startOfDay(date: Date): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function addYears(date: Date, years: number): Date {
  return new Date(date.getFullYear() + years, 0, 1)
}

function getVisibleDays(view: TimeViewId, periodDate: Date): Date[] {
  if (view === 'day') return [startOfDay(periodDate)]
  const weekStart = startOfWeekMonday(periodDate)
  const count = view === 'work-week' ? 5 : 7
  return Array.from({ length: count }, (_, index) => addDays(weekStart, index))
}

function getMonthGridDays(date: Date): Date[] {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
  const gridStart = startOfWeekMonday(monthStart)
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

function getRangeForView(view: CalendarViewId, periodDate: Date): CalendarRange {
  if (view === 'day') {
    const startsAt = startOfDay(periodDate)
    return { startsAt: startsAt.toISOString(), endsAt: addDays(startsAt, 1).toISOString() }
  }
  if (view === 'work-week' || view === 'full-week') {
    const startsAt = startOfWeekMonday(periodDate)
    const days = view === 'work-week' ? 5 : 7
    return { startsAt: startsAt.toISOString(), endsAt: addDays(startsAt, days).toISOString() }
  }
  if (view === 'month') {
    const monthDays = getMonthGridDays(periodDate)
    return { startsAt: monthDays[0]!.toISOString(), endsAt: addDays(monthDays[monthDays.length - 1]!, 1).toISOString() }
  }
  const startsAt = new Date(periodDate.getFullYear(), 0, 1)
  const endsAt = new Date(periodDate.getFullYear() + 1, 0, 1)
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayStartAndEnd(day: Date): { start: Date; end: Date } {
  const start = startOfDay(day)
  return { start, end: addDays(start, 1) }
}

function eventOverlapsDay(event: CalendarEventInstanceView, day: Date): boolean {
  const { start, end } = dayStartAndEnd(day)
  return new Date(event.startsAt) < end && new Date(event.endsAt) > start
}

function formatTimeLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function formatDayHeader(date: Date): string {
  return `${WEEKDAY_HEADERS[(date.getDay() + 6) % 7]}, ${date.getDate()} ${MONTH_LABELS[date.getMonth()]}`
}

function minutesIntoDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function safeTestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function hostSummary(event: CalendarEventInstanceView): string | null {
  if (event.hosts.length === 0) return null
  return `${event.hosts.slice(0, 2).map((host) => host.displayName ?? host.hostname).join(', ')}${event.hosts.length > 2 ? ` +${event.hosts.length - 2}` : ''}`
}

function sortEvents(left: CalendarEventInstanceView, right: CalendarEventInstanceView): number {
  return Date.parse(left.startsAt) - Date.parse(right.startsAt) || Date.parse(left.endsAt) - Date.parse(right.endsAt) || left.title.localeCompare(right.title)
}

function eventsForDay(events: CalendarEventInstanceView[], day: Date): CalendarEventInstanceView[] {
  return events.filter((event) => eventOverlapsDay(event, day)).sort(sortEvents)
}

function timeSlotDate(day: Date, minutes: number): Date {
  const date = startOfDay(day)
  date.setMinutes(minutes)
  return date
}

function EventPill({
  event,
  compact = false,
  onOpen,
  style,
}: {
  event: CalendarEventInstanceView
  compact?: boolean
  onOpen: (event: CalendarEventInstanceView) => void
  style?: CSSProperties
}) {
  const summary = hostSummary(event)
  return (
    <button
      type="button"
      className={`${eventClassName(event).join(' ')} ${compact ? 'ct-ops-calendar-event--compact' : ''}`}
      data-testid={`calendar-rendered-event-${safeTestId(event.id)}`}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation()
        onOpen(event)
      }}
      style={style}
    >
      <span className="truncate text-[0.78rem] font-medium">{event.title}</span>
      {summary && !compact ? <span className="truncate text-[0.68rem] opacity-80">{summary}</span> : null}
    </button>
  )
}

function toDateTimeLocal(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromDateTimeLocal(value: string): string {
  return new Date(value).toISOString()
}

function weekdayForLocalDate(value: string): CalendarWeekday {
  const weekdays: CalendarWeekday[] = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa']
  return weekdays[new Date(value).getDay()] ?? 'mo'
}

function createDraft(start?: Date, end?: Date, allDay = false): EventDraft {
  const startsAt = start ?? new Date()
  const endsAt = end && end > startsAt ? end : new Date(startsAt.getTime() + 60 * 60_000)
  const startsAtLocal = toDateTimeLocal(startsAt)
  return {
    eventId: null,
    recurrenceInstanceStartAt: null,
    mode: 'create',
    title: '',
    description: '',
    startsAt: startsAtLocal,
    endsAt: toDateTimeLocal(endsAt),
    allDay,
    timezone: 'UTC',
    status: 'planned',
    category: 'maintenance',
    recurrenceFrequency: 'none',
    recurrenceInterval: '1',
    recurrenceWeekdays: [weekdayForLocalDate(startsAtLocal)],
    recurrenceEndMode: 'never',
    recurrenceCount: '10',
    recurrenceUntil: startsAtLocal.slice(0, 10),
    hostIds: [],
    participants: [],
  }
}

function draftFromEvent(event: CalendarEventInstanceView): EventDraft {
  const recurrenceRule = event.recurrenceRule
  return {
    eventId: event.eventId,
    recurrenceInstanceStartAt: event.recurrenceInstanceStartAt,
    mode: 'edit',
    title: event.title,
    description: event.description ?? '',
    startsAt: toDateTimeLocal(event.startsAt),
    endsAt: toDateTimeLocal(event.endsAt),
    allDay: event.allDay,
    timezone: event.timezone,
    status: event.status,
    category: event.category,
    recurrenceFrequency: recurrenceRule?.freq ?? 'none',
    recurrenceInterval: String(recurrenceRule?.interval ?? 1),
    recurrenceWeekdays: recurrenceRule?.byWeekday ?? [weekdayForLocalDate(toDateTimeLocal(event.startsAt))],
    recurrenceEndMode: recurrenceRule?.count ? 'count' : recurrenceRule?.until ? 'until' : 'never',
    recurrenceCount: String(recurrenceRule?.count ?? 10),
    recurrenceUntil: recurrenceRule?.until ? recurrenceRule.until.slice(0, 10) : toDateTimeLocal(event.startsAt).slice(0, 10),
    hostIds: event.hosts.map((host) => host.id),
    participants: event.participants.map((participant) => ({ userId: participant.id, role: participant.participantRole })),
  }
}

function buildRecurrenceRule(draft: EventDraft): CalendarRecurrenceRule | null {
  if (draft.recurrenceFrequency === 'none') return null
  const interval = Math.max(1, Number.parseInt(draft.recurrenceInterval, 10) || 1)
  const rule: CalendarRecurrenceRule = {
    freq: draft.recurrenceFrequency,
    interval,
  }
  if (draft.recurrenceFrequency === 'weekly') {
    rule.byWeekday = draft.recurrenceWeekdays.length > 0 ? draft.recurrenceWeekdays : [weekdayForLocalDate(draft.startsAt)]
  }
  if (draft.recurrenceEndMode === 'count') {
    rule.count = Math.max(1, Number.parseInt(draft.recurrenceCount, 10) || 1)
  }
  if (draft.recurrenceEndMode === 'until') {
    rule.until = new Date(`${draft.recurrenceUntil}T23:59:59`).toISOString()
  }
  return rule
}

function eventClassName(event: CalendarEventInstanceView): string[] {
  return [
    'ct-ops-calendar-event',
    `ct-ops-calendar-event--${event.category}`,
    `ct-ops-calendar-event--${event.status}`,
    event.isException ? 'ct-ops-calendar-event--exception' : '',
  ].filter(Boolean)
}

function invalidateCalendarQueries(queryClient: ReturnType<typeof useQueryClient>, instanceId: string): Promise<unknown[]> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['calendar-events', instanceId] }),
    queryClient.invalidateQueries({ queryKey: ['host-calendar-events', instanceId] }),
  ])
}

export function OperationsCalendarClient({
  instanceId,
  canEdit,
  initialHosts,
  initialUsers,
}: {
  instanceId: string
  canEdit: boolean
  initialHosts: CalendarHostOption[]
  initialUsers: CalendarUserOption[]
}) {
  const timeScrollerRef = useRef<HTMLDivElement | null>(null)
  const queryClient = useQueryClient()
  const [periodDate, setPeriodDate] = useState(() => new Date())
  const [currentView, setCurrentView] = useState<CalendarViewId>('full-week')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<EventDraft>(() => createDraft())
  const [formError, setFormError] = useState<string | null>(null)
  const [hostSearch, setHostSearch] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const range = useMemo(() => getRangeForView(currentView, periodDate), [currentView, periodDate])

  const calendarQuery = useQuery({
    queryKey: ['calendar-events', instanceId, range.startsAt, range.endsAt],
    queryFn: () => listCalendarEvents(instanceId, range),
    staleTime: 10_000,
  })

  const hostsQuery = useQuery({
    queryKey: ['calendar-host-options', instanceId, hostSearch],
    queryFn: () => searchCalendarHosts(instanceId, { query: hostSearch, limit: 100 }),
    initialData: { hosts: initialHosts },
    staleTime: 30_000,
    enabled: dialogOpen,
  })

  const usersQuery = useQuery({
    queryKey: ['calendar-user-options', instanceId, userSearch],
    queryFn: () => searchCalendarUsers(instanceId, { query: userSearch, limit: 100 }),
    initialData: { users: initialUsers },
    staleTime: 30_000,
    enabled: dialogOpen,
  })

  const calendarEvents = useMemo<CalendarEventInstanceView[]>(() => {
    if (!calendarQuery.data || 'error' in calendarQuery.data) return []
    return calendarQuery.data.events
  }, [calendarQuery.data])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: draft.title,
        description: draft.description || null,
        startsAt: fromDateTimeLocal(draft.startsAt),
        endsAt: fromDateTimeLocal(draft.endsAt),
        allDay: draft.allDay,
        timezone: draft.timezone,
        status: draft.status,
        category: draft.category,
        recurrenceRule: buildRecurrenceRule(draft),
        hostIds: draft.hostIds,
        participants: draft.participants,
        clientRequestId: draft.mode === 'create' ? crypto.randomUUID() : undefined,
      }
      return draft.mode === 'create' || !draft.eventId
        ? createCalendarEvent(instanceId, payload)
        : updateCalendarEvent(instanceId, draft.eventId, payload)
    },
    onSuccess: (result) => {
      if ('error' in result) {
        setFormError(result.error)
        return
      }
      setDialogOpen(false)
      void invalidateCalendarQueries(queryClient, instanceId)
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Failed to save calendar event')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!draft.eventId) return { error: 'Calendar event not found' } as const
      return deleteCalendarEvent(instanceId, {
        eventId: draft.eventId,
        recurrenceInstanceStartAt: draft.recurrenceInstanceStartAt,
        scope: draft.recurrenceInstanceStartAt ? 'this' : 'series',
      })
    },
    onSuccess: (result) => {
      if ('error' in result) {
        setFormError(result.error)
        return
      }
      setDialogOpen(false)
      void invalidateCalendarQueries(queryClient, instanceId)
    },
  })

  const persistMove = useCallback(
    async (input: {
      eventId: string
      recurrenceInstanceStartAt?: string
      startsAt: string
      endsAt: string
      allDay?: boolean
      scope: 'this' | 'series'
    }) => {
      const result = await moveCalendarEventInstance(instanceId, input)
      if ('error' in result) {
        throw new Error(result.error)
      }
      await invalidateCalendarQueries(queryClient, instanceId)
    },
    [instanceId, queryClient],
  )

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    window.__ctOpsCalendarTestMoveEvent = async (input) => {
      await persistMove(input)
    }
    return () => {
      delete window.__ctOpsCalendarTestMoveEvent
    }
  }, [persistMove])

  useEffect(() => {
    if (currentView !== 'day' && currentView !== 'work-week' && currentView !== 'full-week') return
    const scroller = timeScrollerRef.current
    if (!scroller) return
    const firstSlot = scroller.querySelector<HTMLElement>('[data-time-slot-index="0"]')
    if (!firstSlot) return
    scroller.scrollTop = firstSlot.getBoundingClientRect().height * WORKDAY_SCROLL_SLOT
  }, [currentView, periodDate])

  function changeView(view: CalendarViewId) {
    setCurrentView(view)
  }

  function movePeriod(direction: -1 | 1) {
    setPeriodDate((current) => {
      if (currentView === 'day') return addDays(current, direction)
      if (currentView === 'work-week' || currentView === 'full-week') return addDays(current, direction * 7)
      if (currentView === 'month') return addMonths(current, direction)
      return addYears(current, direction)
    })
  }

  function openCreate(start?: Date, end?: Date, allDay = false) {
    if (!canEdit) return
    setFormError(null)
    setDraft(createDraft(start, end, allDay))
    setDialogOpen(true)
  }

  function openEdit(event: CalendarEventInstanceView) {
    setFormError(null)
    setDraft(draftFromEvent(event))
    setDialogOpen(true)
  }

  function toggleHost(hostId: string) {
    setDraft((current) => ({
      ...current,
      hostIds: current.hostIds.includes(hostId)
        ? current.hostIds.filter((id) => id !== hostId)
        : [...current.hostIds, hostId],
    }))
  }

  function toggleParticipant(userId: string) {
    setDraft((current) => {
      const exists = current.participants.some((participant) => participant.userId === userId)
      return {
        ...current,
        participants: exists
          ? current.participants.filter((participant) => participant.userId !== userId)
          : [...current.participants, { userId, role: 'observer' }],
      }
    })
  }

  function updateParticipantRole(userId: string, role: CalendarParticipantRole) {
    setDraft((current) => ({
      ...current,
      participants: current.participants.map((participant) =>
        participant.userId === userId ? { ...participant, role } : participant,
      ),
    }))
  }

  function toggleWeekday(weekday: CalendarWeekday) {
    setDraft((current) => ({
      ...current,
      recurrenceWeekdays: current.recurrenceWeekdays.includes(weekday)
        ? current.recurrenceWeekdays.filter((value) => value !== weekday)
        : [...current.recurrenceWeekdays, weekday],
    }))
  }

  const hostOptions = 'hosts' in hostsQuery.data ? hostsQuery.data.hosts : initialHosts
  const userOptions = 'users' in usersQuery.data ? usersQuery.data.users : initialUsers
  const calendarError = calendarQuery.data && 'error' in calendarQuery.data ? calendarQuery.data.error : null
  const currentPeriodTitle = useMemo(() => {
    if (currentView === 'month') return formatMonthYear(periodDate)
    if (currentView === 'year') return String(periodDate.getFullYear())
    if (currentView === 'work-week' || currentView === 'full-week') return `W/B ${formatDayMonthYear(startOfWeekMonday(periodDate))}`
    return formatDayMonthYear(periodDate)
  }, [currentView, periodDate])

  function renderTimeView(view: TimeViewId) {
    const days = getVisibleDays(view, periodDate)
    const gridStyle: CSSProperties = {
      gridTemplateColumns: `var(--ct-ops-calendar-time-gutter) repeat(${days.length}, minmax(0, 1fr))`,
    }

    return (
      <div className="ct-ops-calendar-time-view" data-testid="calendar-time-grid">
        <div className="ct-ops-calendar-time-header" style={gridStyle}>
          <div className="ct-ops-calendar-time-header-gutter" />
          {days.map((day) => (
            <div key={localDateKey(day)} className="ct-ops-calendar-time-header-day" data-testid={`calendar-time-header-${localDateKey(day)}`}>
              {formatDayHeader(day)}
            </div>
          ))}
        </div>

        <div className="ct-ops-calendar-all-day-row" style={gridStyle}>
          <div className="ct-ops-calendar-all-day-label">all-day</div>
          {days.map((day) => {
            const dayEvents = eventsForDay(calendarEvents, day).filter((event) => event.allDay)
            return (
              <div key={localDateKey(day)} className="ct-ops-calendar-all-day-cell" data-testid={`calendar-all-day-${localDateKey(day)}`}>
                {dayEvents.map((event) => (
                  <EventPill key={`${event.id}-all-day`} event={event} compact onOpen={openEdit} />
                ))}
              </div>
            )
          })}
        </div>

        <div ref={timeScrollerRef} className="ct-ops-calendar-time-scroll" data-testid="calendar-time-scroll">
          <div className="ct-ops-calendar-time-grid-body" style={gridStyle}>
            <div className="ct-ops-calendar-time-label-column">
              {TIME_SLOTS.map((minutes, index) => {
                const label = formatTimeLabel(minutes)
                return (
                  <div
                    key={minutes}
                    className="ct-ops-calendar-time-label"
                    data-testid={`calendar-time-label-${label.replace(':', '-')}`}
                    data-time-slot-index={index}
                  >
                    {label}
                  </div>
                )
              })}
            </div>

            {days.map((day) => {
              const dayKey = localDateKey(day)
              const timedEvents = eventsForDay(calendarEvents, day).filter((event) => !event.allDay)
              const eventLayouts = getTimedEventLayouts(timedEvents)
              return (
                <div key={dayKey} className="ct-ops-calendar-time-day-stack" data-testid={`calendar-time-day-${dayKey}`}>
                  {TIME_SLOTS.map((minutes, index) => {
                    const slotLabel = formatTimeLabel(minutes)
                    const start = timeSlotDate(day, minutes)
                    const end = timeSlotDate(day, minutes + TIME_SLOT_MINUTES)
                    return (
                      <button
                        key={`${dayKey}-${minutes}`}
                        type="button"
                        className="ct-ops-calendar-time-slot"
                        data-testid={`calendar-time-slot-${slotLabel.replace(':', '-')}-${dayKey}`}
                        data-time-slot-index={index}
                        aria-label={`${slotLabel} on ${formatDayHeader(day)}`}
                        disabled={!canEdit}
                        onClick={() => openCreate(start, end, false)}
                      />
                    )
                  })}
                  {timedEvents.map((event) => {
                    const layout = eventLayouts[event.id] ?? {
                      leftPercent: 0,
                      widthPercent: 100,
                    }
                    const dayStart = startOfDay(day)
                    const startsAt = new Date(event.startsAt)
                    const endsAt = new Date(event.endsAt)
                    const startMinutes = startsAt < dayStart ? 0 : minutesIntoDay(startsAt)
                    const endMinutes = endsAt > addDays(dayStart, 1) ? 24 * 60 : minutesIntoDay(endsAt)
                    const topSlots = clamp(startMinutes / TIME_SLOT_MINUTES, 0, TIME_SLOT_COUNT)
                    const heightSlots = Math.max(0.5, clamp(endMinutes / TIME_SLOT_MINUTES, 0, TIME_SLOT_COUNT) - topSlots)
                    return (
                      <EventPill
                        key={`${event.id}-${dayKey}`}
                        event={event}
                        onOpen={openEdit}
                        style={{
                          left: `calc(${layout.leftPercent}% + 0.25rem)`,
                          width: `calc(${layout.widthPercent}% - 0.5rem)`,
                          top: `calc(${topSlots} * var(--ct-ops-calendar-time-slot-height) + 2px)`,
                          height: `max(1.5rem, calc(${heightSlots} * var(--ct-ops-calendar-time-slot-height) - 4px))`,
                        }}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  function renderMonthView() {
    const activeMonth = periodDate.getMonth()
    const days = getMonthGridDays(periodDate)

    return (
      <div className="ct-ops-calendar-month-view" data-testid="calendar-month-grid">
        <div className="ct-ops-calendar-month-weekdays">
          {WEEKDAY_HEADERS.map((weekday) => (
            <div key={weekday} className="ct-ops-calendar-month-weekday">{weekday}</div>
          ))}
        </div>
        <div className="ct-ops-calendar-month-days">
          {days.map((day) => {
            const dayEvents = eventsForDay(calendarEvents, day)
            const dayKey = localDateKey(day)
            const isCurrentMonth = day.getMonth() === activeMonth
            return (
              <div
                key={dayKey}
                className={`ct-ops-calendar-month-day ${isCurrentMonth ? '' : 'ct-ops-calendar-month-day--muted'}`}
                data-testid={`calendar-month-day-${dayKey}`}
                onDoubleClick={() => {
                  if (canEdit) openCreate(startOfDay(day), addDays(startOfDay(day), 1), true)
                }}
              >
                <div className="ct-ops-calendar-month-day-number">{day.getDate()} {MONTH_LABELS[day.getMonth()]}</div>
                <div className="ct-ops-calendar-month-day-events">
                  {dayEvents.slice(0, 4).map((event) => (
                    <EventPill key={`${event.id}-${dayKey}`} event={event} compact onOpen={openEdit} />
                  ))}
                  {dayEvents.length > 4 ? <div className="ct-ops-calendar-more-events">+{dayEvents.length - 4} more</div> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderYearView() {
    const year = periodDate.getFullYear()

    return (
      <div className="ct-ops-calendar-year-view" data-testid="calendar-year-grid">
        <div className="ct-ops-calendar-year-months">
          {MONTH_LABELS.map((month, monthIndex) => {
            const monthDate = new Date(year, monthIndex, 1)
            const days = getMonthGridDays(monthDate)
            return (
              <div key={month} className="ct-ops-calendar-year-month" data-testid={`calendar-year-month-${month}`}>
                <div className="ct-ops-calendar-year-month-title">{month}</div>
                <div className="ct-ops-calendar-year-weekdays">
                  {WEEKDAY_HEADERS.map((weekday) => (
                    <div key={weekday}>{weekday}</div>
                  ))}
                </div>
                <div className="ct-ops-calendar-year-days">
                  {days.map((day) => {
                    const dayKey = localDateKey(day)
                    const dayEvents = eventsForDay(calendarEvents, day)
                    const isCurrentMonth = day.getMonth() === monthIndex
                    return (
                      <div
                        key={`${month}-${dayKey}`}
                        className={`ct-ops-calendar-year-day ${isCurrentMonth ? '' : 'ct-ops-calendar-year-day--muted'}`}
                        data-testid={`calendar-year-day-${dayKey}`}
                      >
                        <span>{day.getDate()}</span>
                        {dayEvents.length > 0 ? <span className="ct-ops-calendar-year-day-event-count">{dayEvents.length}</span> : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid="operations-calendar-heading">
            Operations Calendar
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan maintenance windows, patching, application work, and operational events.
          </p>
        </div>
        {canEdit ? (
          <Button onClick={() => openCreate()} data-testid="calendar-new-event">
            <Plus className="size-4" />
            New Event
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => movePeriod(-1)} aria-label="Previous" data-testid="calendar-prev">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPeriodDate(new Date())} data-testid="calendar-today">
            Today
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => movePeriod(1)} aria-label="Next" data-testid="calendar-next">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div
          className="order-3 min-w-full text-center text-sm font-semibold text-foreground sm:order-none sm:min-w-0"
          data-testid="calendar-period-title"
        >
          {currentPeriodTitle}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {VIEW_OPTIONS.map((option) => (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={currentView === option.id ? 'default' : 'outline'}
              onClick={() => changeView(option.id)}
              data-testid={`calendar-view-${option.id}`}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {calendarError ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {calendarError}
        </div>
      ) : null}

      <div className="ct-ops-calendar flex-1 rounded-lg border bg-card">
        {calendarQuery.isFetching ? (
          <div className="absolute right-8 top-32 z-10 inline-flex items-center rounded-md border bg-popover px-2 py-1 text-xs text-muted-foreground shadow-sm">
            <Loader2 className="mr-1 size-3 animate-spin" />
            Loading
          </div>
        ) : null}
        {currentView === 'day' || currentView === 'work-week' || currentView === 'full-week'
          ? renderTimeView(currentView)
          : currentView === 'month'
            ? renderMonthView()
            : renderYearView()}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="inline-flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground" />
              {draft.mode === 'create' ? 'New calendar event' : 'Edit calendar event'}
            </DialogTitle>
            <DialogDescription>
              {draft.mode === 'create' ? 'Create a shared operational planning event.' : 'Update the selected calendar event.'}
            </DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              setFormError(null)
              saveMutation.mutate()
            }}
          >
            <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="calendar-event-title">Title</Label>
                  <Input
                    id="calendar-event-title"
                    data-testid="calendar-event-title"
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="calendar-event-description">Description</Label>
                  <Textarea
                    id="calendar-event-description"
                    data-testid="calendar-event-description"
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    rows={4}
                  />
                </div>
              </div>

              <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="calendar-event-starts-at">Start</Label>
                    <Input
                      id="calendar-event-starts-at"
                      data-testid="calendar-event-starts-at"
                      type="datetime-local"
                      value={draft.startsAt}
                      onChange={(event) => setDraft((current) => ({ ...current, startsAt: event.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="calendar-event-ends-at">End</Label>
                    <Input
                      id="calendar-event-ends-at"
                      data-testid="calendar-event-ends-at"
                      type="datetime-local"
                      value={draft.endsAt}
                      onChange={(event) => setDraft((current) => ({ ...current, endsAt: event.target.value }))}
                      required
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="calendar-event-all-day">All day</Label>
                  <Switch
                    id="calendar-event-all-day"
                    checked={draft.allDay}
                    onCheckedChange={(checked) => setDraft((current) => ({ ...current, allDay: checked }))}
                  />
                </div>
                <div>
                  <Label htmlFor="calendar-event-timezone">Timezone</Label>
                  <Input
                    id="calendar-event-timezone"
                    value={draft.timezone}
                    onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label htmlFor="calendar-event-category">Category</Label>
                <select
                  id="calendar-event-category"
                  className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
                  value={draft.category}
                  onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as CalendarEventCategory }))}
                >
                  {CALENDAR_EVENT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="calendar-event-status">Status</Label>
                <select
                  id="calendar-event-status"
                  className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
                  value={draft.status}
                  onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as CalendarEventStatus }))}
                >
                  {CALENDAR_EVENT_STATUSES.map((status) => (
                    <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="calendar-recurrence-frequency">Repeat</Label>
                <select
                  id="calendar-recurrence-frequency"
                  className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
                  value={draft.recurrenceFrequency}
                  onChange={(event) => setDraft((current) => ({ ...current, recurrenceFrequency: event.target.value as RecurrenceFrequencyDraft }))}
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            </div>

            {draft.recurrenceFrequency !== 'none' ? (
              <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-[0.5fr_1fr_0.8fr]">
                <div>
                  <Label htmlFor="calendar-recurrence-interval">Interval</Label>
                  <Input
                    id="calendar-recurrence-interval"
                    type="number"
                    min={1}
                    max={99}
                    value={draft.recurrenceInterval}
                    onChange={(event) => setDraft((current) => ({ ...current, recurrenceInterval: event.target.value }))}
                  />
                </div>
                {draft.recurrenceFrequency === 'weekly' ? (
                  <div>
                    <Label>Days</Label>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {CALENDAR_WEEKDAYS.map((weekday) => (
                        <Button
                          key={weekday}
                          type="button"
                          size="sm"
                          variant={draft.recurrenceWeekdays.includes(weekday) ? 'default' : 'outline'}
                          onClick={() => toggleWeekday(weekday)}
                        >
                          {WEEKDAY_LABELS[weekday]}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : <div />}
                <div>
                  <Label htmlFor="calendar-recurrence-end">Ends</Label>
                  <select
                    id="calendar-recurrence-end"
                    className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
                    value={draft.recurrenceEndMode}
                    onChange={(event) => setDraft((current) => ({ ...current, recurrenceEndMode: event.target.value as RecurrenceEndMode }))}
                  >
                    <option value="never">Never</option>
                    <option value="count">After count</option>
                    <option value="until">On date</option>
                  </select>
                  {draft.recurrenceEndMode === 'count' ? (
                    <Input
                      className="mt-2"
                      type="number"
                      min={1}
                      max={500}
                      value={draft.recurrenceCount}
                      onChange={(event) => setDraft((current) => ({ ...current, recurrenceCount: event.target.value }))}
                    />
                  ) : null}
                  {draft.recurrenceEndMode === 'until' ? (
                    <Input
                      className="mt-2"
                      type="date"
                      value={draft.recurrenceUntil}
                      onChange={(event) => setDraft((current) => ({ ...current, recurrenceUntil: event.target.value }))}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border">
                <div className="border-b p-3">
                  <Label htmlFor="calendar-host-search">Hosts</Label>
                  <Input
                    id="calendar-host-search"
                    className="mt-2"
                    value={hostSearch}
                    onChange={(event) => setHostSearch(event.target.value)}
                    placeholder="Search hosts"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto p-2">
                  {hostOptions.map((host) => {
                    const checked = draft.hostIds.includes(host.id)
                    return (
                      <label key={host.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleHost(host.id)}
                          data-testid={`calendar-host-option-${host.id}`}
                        />
                        <span className="min-w-0 flex-1 truncate">{host.displayName ?? host.hostname}</span>
                        {host.os ? <span className="text-xs text-muted-foreground">{host.os}</span> : null}
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-lg border">
                <div className="border-b p-3">
                  <Label htmlFor="calendar-user-search">Participants</Label>
                  <Input
                    id="calendar-user-search"
                    className="mt-2"
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Search users"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto p-2">
                  {userOptions.map((user) => {
                    const participant = draft.participants.find((item) => item.userId === user.id)
                    return (
                      <div key={user.id} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                        <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={Boolean(participant)}
                            onChange={() => toggleParticipant(user.id)}
                            data-testid={`calendar-participant-option-${user.id}`}
                          />
                          <span className="min-w-0 truncate">{user.name}</span>
                        </label>
                        <select
                          className="h-7 rounded-md border bg-background px-2 text-xs"
                          value={participant?.role ?? 'observer'}
                          disabled={!participant}
                          onChange={(event) => updateParticipantRole(user.id, event.target.value as CalendarParticipantRole)}
                          data-testid={`calendar-participant-role-${user.id}`}
                        >
                          {CALENDAR_PARTICIPANT_ROLES.map((role) => (
                            <option key={role} value={role}>{PARTICIPANT_ROLE_LABELS[role]}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {formError ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {formError}
              </div>
            ) : null}

            <DialogFooter>
              {draft.mode === 'edit' && canEdit ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending || saveMutation.isPending}
                >
                  {deleteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Delete
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              {canEdit ? (
                <Button type="submit" disabled={saveMutation.isPending} data-testid="calendar-event-submit">
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Save
                </Button>
              ) : null}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
