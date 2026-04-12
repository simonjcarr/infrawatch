import { useState, useCallback } from 'react'
import type { MouseEvent } from 'react'
import type { CategoricalChartFunc } from 'recharts/types/chart/types'
import type { MetricsBounds } from '@/lib/actions/agents'

export interface ChartZoomHandlers {
  onMouseDown: CategoricalChartFunc<MouseEvent<SVGGraphicsElement>>
  onMouseMove: CategoricalChartFunc<MouseEvent<SVGGraphicsElement>>
  onMouseUp: CategoricalChartFunc<MouseEvent<SVGGraphicsElement>>
  onMouseLeave: CategoricalChartFunc<MouseEvent<SVGGraphicsElement>>
}

export interface UseChartZoomReturn {
  zoomedBounds: MetricsBounds | null
  isZoomed: boolean
  chartHandlers: ChartZoomHandlers
  chartCursor: React.CSSProperties['cursor']
  selectionRange: { x1: number; x2: number } | null
  resetZoom: () => void
}

// Minimum drag span to register as a zoom (prevents accidental micro-zooms on click)
const MIN_ZOOM_MS = 5_000

export function useChartZoom(): UseChartZoomReturn {
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [dragCurrent, setDragCurrent] = useState<number | null>(null)
  const [zoomedBounds, setZoomedBounds] = useState<MetricsBounds | null>(null)

  const onMouseDown: ChartZoomHandlers['onMouseDown'] = (next) => {
    if (typeof next.activeLabel !== 'number') return
    setDragStart(next.activeLabel)
    setDragCurrent(next.activeLabel)
  }

  const onMouseMove: ChartZoomHandlers['onMouseMove'] = (next) => {
    if (dragStart == null || typeof next.activeLabel !== 'number') return
    setDragCurrent(next.activeLabel)
  }

  const onMouseUp: ChartZoomHandlers['onMouseUp'] = () => {
    if (dragStart != null && dragCurrent != null) {
      const from = Math.min(dragStart, dragCurrent)
      const to = Math.max(dragStart, dragCurrent)
      if (to - from > MIN_ZOOM_MS) {
        setZoomedBounds({ from, to })
      }
    }
    setDragStart(null)
    setDragCurrent(null)
  }

  const onMouseLeave: ChartZoomHandlers['onMouseLeave'] = () => {
    // Cancel in-progress drag if the cursor leaves the chart area
    setDragStart(null)
    setDragCurrent(null)
  }

  const resetZoom = useCallback(() => {
    setZoomedBounds(null)
    setDragStart(null)
    setDragCurrent(null)
  }, [])

  return {
    zoomedBounds,
    isZoomed: zoomedBounds != null,
    chartHandlers: { onMouseDown, onMouseMove, onMouseUp, onMouseLeave },
    chartCursor: dragStart != null ? 'col-resize' : 'crosshair',
    selectionRange:
      dragStart != null && dragCurrent != null
        ? { x1: Math.min(dragStart, dragCurrent), x2: Math.max(dragStart, dragCurrent) }
        : null,
    resetZoom,
  }
}
