'use client'

import { format } from 'date-fns'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import type { ChartZoomHandlers } from '@/hooks/use-chart-zoom'

interface DataPoint {
  time: number
  cpu: number | null
  memory: number | null
  disk: number | null
}

interface HostMetricsLineChartProps {
  data: DataPoint[]
  xAxisDomain: [number, number] | readonly ['dataMin', () => number]
  tickFormat: string
  selectionRange: { x1: number; x2: number } | null
  chartHandlers: ChartZoomHandlers
  chartCursor: React.CSSProperties['cursor']
}

export function HostMetricsLineChart({
  data,
  xAxisDomain,
  tickFormat,
  selectionRange,
  chartHandlers,
  chartCursor,
}: HostMetricsLineChartProps) {
  // Wrap in a div with text-muted-foreground so that SVG tick elements using
  // fill="currentColor" inherit the correct color in both light and dark mode.
  // (CSS custom properties don't resolve in SVG presentation attributes, but they
  // do resolve in the CSS `color` property, which currentColor reads from.)
  return (
    <div className="text-muted-foreground">
    <ResponsiveContainer width="100%" height={320}>
      <LineChart
        data={data}
        margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
        syncId="host-metrics"
        syncMethod="value"
        cursor={chartCursor}
        {...chartHandlers}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="time"
          type="number"
          domain={xAxisDomain}
          tick={{ fontSize: 12, fill: 'currentColor' }}
          tickLine={false}
          tickFormatter={(ts: number) => format(new Date(ts), tickFormat)}
          tickCount={7}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 12, fill: 'currentColor' }}
          tickLine={false}
          tickFormatter={(v: number) => `${v}%`}
          width={40}
        />
        <Tooltip
          formatter={(value) => [`${value}%`]}
          labelFormatter={(ts) => format(new Date(Number(ts)), 'MMM d HH:mm:ss')}
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
            color: 'hsl(var(--popover-foreground))',
            fontSize: '12px',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
        {selectionRange != null && (
          <ReferenceArea
            x1={selectionRange.x1}
            x2={selectionRange.x2}
            fill="hsl(221, 83%, 53%)"
            fillOpacity={0.15}
            strokeOpacity={0}
          />
        )}
        <Line
          type="monotone"
          dataKey="cpu"
          name="CPU"
          stroke="hsl(221, 83%, 53%)"
          dot={false}
          strokeWidth={2}
        />
        <Line
          type="monotone"
          dataKey="memory"
          name="Memory"
          stroke="hsl(142, 71%, 45%)"
          dot={false}
          strokeWidth={2}
        />
        <Line
          type="monotone"
          dataKey="disk"
          name="Disk"
          stroke="hsl(38, 92%, 50%)"
          dot={false}
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
    </div>
  )
}
