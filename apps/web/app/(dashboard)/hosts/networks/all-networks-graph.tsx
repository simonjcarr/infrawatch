'use client'

import { useMemo } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  NetworkNodeComponent,
  HostNodeComponent,
} from './components/network-flow-nodes'
import { AnimatedFlowEdge } from './components/animated-flow-edge'
import type { Network as NetworkType, Host } from '@/lib/db/schema'

export type NetworkWithHosts = NetworkType & { hosts: Host[] }

const nodeTypes = {
  networkNode: NetworkNodeComponent,
  hostNode: HostNodeComponent,
}

const edgeTypes = {
  animatedFlow: AnimatedFlowEdge,
}

const NETWORK_W = 220
const HOST_W = 190
const HOST_H = 72
const COL_WIDTH = 270
const HOST_Y_START = 220
const HOST_ROW_GAP = 20

function computeLayout(
  networksWithHosts: NetworkWithHosts[],
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Place network nodes in a horizontal row
  networksWithHosts.forEach((network, colIdx) => {
    const colCenterX = colIdx * COL_WIDTH + COL_WIDTH / 2
    nodes.push({
      id: `net-${network.id}`,
      type: 'networkNode',
      position: { x: colCenterX - NETWORK_W / 2, y: 0 },
      data: { name: network.name, cidr: network.cidr },
    })
  })

  // Track which column "owns" each host (first network encountered)
  const hostPrimaryCol = new Map<string, number>()

  networksWithHosts.forEach((network, colIdx) => {
    network.hosts.forEach((host) => {
      if (!hostPrimaryCol.has(host.id)) {
        hostPrimaryCol.set(host.id, colIdx)
      }
    })
  })

  // Place host nodes under their primary column
  const colRowCounters = new Map<number, number>()
  const placedHosts = new Set<string>()

  networksWithHosts.forEach((network) => {
    network.hosts.forEach((host) => {
      const primaryCol = hostPrimaryCol.get(host.id) ?? 0

      if (!placedHosts.has(host.id)) {
        placedHosts.add(host.id)
        const rowIdx = colRowCounters.get(primaryCol) ?? 0
        colRowCounters.set(primaryCol, rowIdx + 1)

        const colCenterX = primaryCol * COL_WIDTH + COL_WIDTH / 2
        nodes.push({
          id: `host-${host.id}`,
          type: 'hostNode',
          position: {
            x: colCenterX - HOST_W / 2,
            y: HOST_Y_START + rowIdx * (HOST_H + HOST_ROW_GAP),
          },
          data: {
            name: host.displayName ?? host.hostname ?? host.id,
            ipAddresses: (host.ipAddresses as string[] | null) ?? [],
            status: host.status ?? 'unknown',
            hostId: host.id,
            orgId: host.organisationId,
          },
        })
      }

      // Edge from this network to the host
      edges.push({
        id: `e-${network.id}-${host.id}`,
        source: `net-${network.id}`,
        target: `host-${host.id}`,
        type: 'animatedFlow',
        data: { hostStatus: host.status ?? 'unknown' },
      })
    })
  })

  return { nodes, edges }
}

interface Props {
  networksWithHosts: NetworkWithHosts[]
}

export function AllNetworksGraph({ networksWithHosts }: Props) {
  const { nodes, edges } = useMemo(
    () => computeLayout(networksWithHosts),
    [networksWithHosts],
  )

  const graphKey = networksWithHosts
    .map((n) => `${n.id}:${n.hosts.map((h) => h.id).join(',')}`)
    .join('|')

  return (
    <div className="w-full h-[620px] rounded-lg border overflow-hidden">
      <ReactFlow
        key={graphKey}
        defaultNodes={nodes}
        defaultEdges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.15 }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="hsl(var(--border))"
        />
        <Controls />
        <MiniMap nodeStrokeWidth={3} />
      </ReactFlow>
    </div>
  )
}
