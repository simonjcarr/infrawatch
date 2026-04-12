'use client'

import { format } from 'date-fns'
import {
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import type { ChartZoomHandlers } from '@/hooks/use-chart-zoom'
import type { HeartbeatPoint } from '@/lib/actions/agents'

interface HostHeartbeatBarChartProps {
  data: HeartbeatPoint[]
  xAxisDomain: [number, number] | readonly ['dataMin', () => number]
  tickFormat: string
  selectionRange: { x1: number; x2: number } | null
  chartHandlers: ChartZoomHandlers
  chartCursor: React.CSSProperties['cursor']
}

export function HostHeartbeatBarChart({
  data,
  xAxisDomain,
  tickFormat,
  selectionRange,
  chartHandlers,
  chartCursor,
}: HostHeartbeatBarChartProps) {
  return (
    <div className="text-muted-foreground">
    <ResponsiveContainer width="100%" height={200}>
      <BarChart
        data={data}
        margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
        syncId="host-metrics"
        syncMethod="value"
        cursor={chartCursor}
        {...chartHandlers}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
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
          tick={{ fontSize: 12, fill: 'currentColor' }}
          tickLine={false}
          tickFormatter={(v: number) => `${v}s`}
          width={40}
        />
        <Tooltip
          formatter={(value) => [`${value}s`, 'Interval']}
          labelFormatter={(ts) => format(new Date(Number(ts)), 'MMM d HH:mm:ss')}
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
            color: 'hsl(var(--popover-foreground))',
            fontSize: '12px',
          }}
        />
        {/* Expected heartbeat interval reference line */}
        <ReferenceLine
          y={30}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="4 2"
          strokeOpacity={0.5}
          label={{
            value: '30s',
            position: 'insideTopRight',
            fontSize: 11,
            fill: 'currentColor',
          }}
        />
        {selectionRange != null && (
          <ReferenceArea
            x1={selectionRange.x1}
            x2={selectionRange.x2}
            fill="hsl(221, 83%, 53%)"
            fillOpacity={0.15}
            strokeOpacity={0}
          />
        )}
        <Bar dataKey="intervalSecs" name="Interval" radius={[2, 2, 0, 0]} maxBarSize={24}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={
                entry.intervalSecs <= 45
                  ? 'hsl(142, 71%, 45%)'
                  : entry.intervalSecs <= 120
                    ? 'hsl(38, 92%, 50%)'
                    : 'hsl(0, 84%, 60%)'
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
  )
}
