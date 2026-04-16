'use client'

import { useMemo, useState, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  NetworkNodeComponent,
  HostNodeComponent,
  type HostNodeData,
} from '../components/network-flow-nodes'
import { AnimatedFlowEdge } from '../components/animated-flow-edge'
import { HostNodeContextMenu } from '../components/host-node-context-menu'
import type { Network as NetworkType, Host } from '@/lib/db/schema'

const nodeTypes = {
  networkNode: NetworkNodeComponent,
  hostNode: HostNodeComponent,
}

const edgeTypes = {
  animatedFlow: AnimatedFlowEdge,
}

const NETWORK_W = 220
const NETWORK_H = 84
const HOST_W = 190
const HOST_H = 72
const HOSTS_PER_ROW = 5
const HOST_COL_GAP = 20
const HOST_ROW_GAP = 30
const NETWORK_HOST_GAP = 80

interface Props {
  network: NetworkType
  hosts: Host[]
}

function computeLayout(
  network: NetworkType,
  hosts: Host[],
): { nodes: Node[]; edges: Edge[] } {
  const n = hosts.length
  const cols = Math.min(Math.max(n, 1), HOSTS_PER_ROW)
  const totalGridW = cols * HOST_W + (cols - 1) * HOST_COL_GAP

  const networkX = Math.max(0, (totalGridW - NETWORK_W) / 2)

  const nodes: Node[] = [
    {
      id: 'network',
      type: 'networkNode',
      position: { x: networkX, y: 0 },
      data: { name: network.name, cidr: network.cidr },
    },
  ]

  const edges: Edge[] = []

  hosts.forEach((host, i) => {
    const row = Math.floor(i / HOSTS_PER_ROW)
    const col = i % HOSTS_PER_ROW

    // Center the last (possibly partial) row
    const isLastRow = row === Math.floor((n - 1) / HOSTS_PER_ROW)
    const rowCols = isLastRow ? ((n - 1) % HOSTS_PER_ROW) + 1 : HOSTS_PER_ROW
    const rowW = rowCols * HOST_W + (rowCols - 1) * HOST_COL_GAP
    const rowStartX = (totalGridW - rowW) / 2

    nodes.push({
      id: `host-${host.id}`,
      type: 'hostNode',
      className: 'cursor-default',
      position: {
        x: rowStartX + col * (HOST_W + HOST_COL_GAP),
        y: NETWORK_H + NETWORK_HOST_GAP + row * (HOST_H + HOST_ROW_GAP),
      },
      data: {
        name: host.displayName ?? host.hostname ?? host.id,
        ipAddresses: (host.ipAddresses as string[] | null) ?? [],
        status: host.status ?? 'unknown',
        hostId: host.id,
        orgId: host.organisationId,
      },
    })

    edges.push({
      id: `e-${host.id}`,
      source: 'network',
      target: `host-${host.id}`,
      type: 'animatedFlow',
      data: { hostStatus: host.status ?? 'unknown' },
    })
  })

  return { nodes, edges }
}

interface ContextMenuState {
  x: number
  y: number
  data: HostNodeData
}

export function NetworkGraph({ network, hosts }: Props) {
  const { nodes, edges } = useMemo(
    () => computeLayout(network, hosts),
    [network, hosts],
  )

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const graphKey = `${network.id}-${hosts
    .map((h) => h.id)
    .sort()
    .join(',')}`

  const handleNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
    if (node.type !== 'hostNode') return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, data: node.data as HostNodeData })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  return (
    <div className="w-full h-[520px] rounded-lg border overflow-hidden" onContextMenu={(e) => e.preventDefault()}>
      <ReactFlow
        key={graphKey}
        defaultNodes={nodes}
        defaultEdges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneClick={closeContextMenu}
        onMoveStart={closeContextMenu}
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

      {contextMenu && (
        <HostNodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          data={contextMenu.data}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
}
