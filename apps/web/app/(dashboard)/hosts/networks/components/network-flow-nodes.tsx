'use client'

import { memo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { CheckCircle, WifiOff, AlertTriangle, Network, Server, Terminal } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTerminalPanel } from '@/components/terminal'

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
  const router = useRouter()
  const { openTerminal } = useTerminalPanel()
  const [usernameDialogOpen, setUsernameDialogOpen] = useState(false)
  const [username, setUsername] = useState('')

  const handleOpenTerminalMenu = useCallback(() => {
    try {
      const saved = localStorage.getItem(`terminal-username:${data.hostId}`) ?? ''
      setUsername(saved)
    } catch {
      setUsername('')
    }
    setUsernameDialogOpen(true)
  }, [data.hostId])

  const handleConnect = useCallback(() => {
    try {
      if (username.trim()) {
        localStorage.setItem(`terminal-username:${data.hostId}`, username.trim())
      }
    } catch {
      // localStorage may be unavailable
    }
    openTerminal({
      hostId: data.hostId,
      hostname: data.name,
      username: username.trim() || null,
      orgId: data.orgId,
      directAccess: false,
    })
    setUsernameDialogOpen(false)
  }, [username, data.hostId, data.name, data.orgId, openTerminal])

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="bg-card border rounded-lg px-3 py-2.5 shadow-sm min-w-[170px] cursor-default">
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
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={handleOpenTerminalMenu}>
            <Terminal className="size-4 mr-2" />
            Open Terminal
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => router.push(`/hosts/${data.hostId}`)}>
            <Server className="size-4 mr-2" />
            View Host
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={usernameDialogOpen} onOpenChange={setUsernameDialogOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Connect to {data.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="node-terminal-username">Username</Label>
            <Input
              id="node-terminal-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. jsmith"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && username.trim()) handleConnect()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUsernameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConnect} disabled={!username.trim()}>
              <Terminal className="size-4 mr-1.5" />
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
})
