'use client'

import { memo } from 'react'
import { getBezierPath, type EdgeProps } from '@xyflow/react'

/**
 * Dashed bezier edge with a slow flowing stroke-dashoffset animation —
 * matching the React Flow homepage aesthetic.
 *
 * The keyframe `rf-dash-flow` is defined in globals.css.
 */
export const AnimatedFlowEdge = memo(function AnimatedFlowEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <>
      {/* Very subtle base line so the edge is visible even when zoomed out */}
      <path
        d={edgePath}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth={1.5}
        opacity={0.15}
      />

      {/* Slowly flowing dashes — the main visual */}
      <path
        d={edgePath}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth={1.5}
        strokeDasharray="6 4"
        style={{ animation: 'rf-dash-flow 10s linear infinite', opacity: 0.55 }}
      />

      {/* Small dots at handle endpoints, like the React Flow homepage */}
      <circle cx={sourceX} cy={sourceY} r={3} fill="var(--muted-foreground)" opacity={0.45} />
      <circle cx={targetX} cy={targetY} r={3} fill="var(--muted-foreground)" opacity={0.45} />
    </>
  )
})
