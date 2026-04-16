'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { CheckCircle, WifiOff, AlertTriangle, Network, Server } from 'lucide-react'

// ── Network Node ──────────────────────────────────────────────────────────────

export type NetworkNodeData = {
  name: string
  cidr: string
}

export type NetworkFlowNode = Node<NetworkNodeData, 'networkNode'>

export const NetworkNodeComponent = memo(function NetworkNodeComponent({
  data,
}: NodeProps<NetworkFlowNode>) {
  return (
    <div className="bg-card border-2 border-primary/40 rounded-lg px-4 py-3 shadow-md min-w-[200px]">
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="flex items-center gap-2 mb-1.5">
        <Network className="size-4 text-primary shrink-0" />
        <span className="font-semibold text-sm text-card-foreground truncate max-w-[170px]">
          {data.name}
        </span>
      </div>
      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">
        {data.cidr}
      </code>
    </div>
  )
})

// ── Host Node ─────────────────────────────────────────────────────────────────

export type HostNodeData = {
  name: string
  ipAddresses: string[]
  status: string
  hostId: string
  orgId: string
}

export type HostFlowNode = Node<HostNodeData, 'hostNode'>

function StatusDot({ status }: { status: string }) {
  if (status === 'online') return <CheckCircle className="size-3 text-green-500 shrink-0" />
  if (status === 'offline') return <WifiOff className="size-3 text-red-500 shrink-0" />
  return <AlertTriangle className="size-3 text-yellow-500 shrink-0" />
}

export const HostNodeComponent = memo(function HostNodeComponent({
  data,
}: NodeProps<HostFlowNode>) {
  return (
    <div className="bg-card border rounded-lg px-3 py-2.5 shadow-sm min-w-[170px] cursor-default select-none">
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="flex items-center gap-1.5 mb-1">
        <StatusDot status={data.status} />
        <Server className="size-3 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-card-foreground truncate max-w-[140px]">
          {data.name}
        </span>
      </div>
      {data.ipAddresses.length > 0 && (
        <p className="text-xs text-muted-foreground font-mono truncate">
          {data.ipAddresses[0]}
          {data.ipAddresses.length > 1 && (
            <span className="text-muted-foreground/70"> +{data.ipAddresses.length - 1}</span>
          )}
        </p>
      )}
    </div>
  )
})
