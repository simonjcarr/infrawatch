export interface TimedEventLayoutInput {
  id: string
  startsAt: string
  endsAt: string
}

export interface TimedEventLayout {
  column: number
  columns: number
  leftPercent: number
  widthPercent: number
}

interface TimedEventLayoutItem extends TimedEventLayoutInput {
  startMs: number
  endMs: number
  order: number
}

interface AssignedTimedEventLayout {
  id: string
  column: number
}

function overlaps(left: TimedEventLayoutItem, right: TimedEventLayoutItem): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs
}

function sortTimedLayoutItems(left: TimedEventLayoutItem, right: TimedEventLayoutItem): number {
  return left.startMs - right.startMs || left.endMs - right.endMs || left.order - right.order
}

function assignGroupLayouts(group: TimedEventLayoutItem[]): Record<string, TimedEventLayout> {
  const activeColumns: Array<{ column: number; endMs: number }> = []
  const assigned: AssignedTimedEventLayout[] = []
  let columns = 0

  for (const item of group) {
    for (let index = activeColumns.length - 1; index >= 0; index -= 1) {
      if (activeColumns[index]!.endMs <= item.startMs) {
        activeColumns.splice(index, 1)
      }
    }

    const unavailableColumns = new Set(activeColumns.map((column) => column.column))
    let column = 0
    while (unavailableColumns.has(column)) column += 1

    activeColumns.push({ column, endMs: item.endMs })
    assigned.push({ id: item.id, column })
    columns = Math.max(columns, column + 1)
  }

  const widthPercent = 100 / Math.max(1, columns)
  return Object.fromEntries(
    assigned.map(({ id, column }) => [
      id,
      {
        column,
        columns,
        leftPercent: column * widthPercent,
        widthPercent,
      },
    ]),
  )
}

export function getTimedEventLayouts(events: TimedEventLayoutInput[]): Record<string, TimedEventLayout> {
  const items = events
    .map((event, order) => ({
      ...event,
      startMs: Date.parse(event.startsAt),
      endMs: Date.parse(event.endsAt),
      order,
    }))
    .filter((event) => Number.isFinite(event.startMs) && Number.isFinite(event.endMs) && event.endMs > event.startMs)
    .sort(sortTimedLayoutItems)

  const layouts: Record<string, TimedEventLayout> = {}
  let group: TimedEventLayoutItem[] = []

  function flushGroup() {
    Object.assign(layouts, assignGroupLayouts(group))
    group = []
  }

  for (const item of items) {
    if (group.length > 0 && !group.some((groupItem) => overlaps(groupItem, item))) {
      flushGroup()
    }
    group.push(item)
  }

  if (group.length > 0) flushGroup()

  return layouts
}
