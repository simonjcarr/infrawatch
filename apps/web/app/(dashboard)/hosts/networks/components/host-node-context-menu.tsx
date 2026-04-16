'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Terminal, Server } from 'lucide-react'
import { useTerminalPanel } from '@/components/terminal'
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
import type { HostNodeData } from './network-flow-nodes'

interface Props {
  x: number
  y: number
  data: HostNodeData
  onClose: () => void
}

export function HostNodeContextMenu({ x, y, data, onClose }: Props) {
  const router = useRouter()
  const { openTerminal } = useTerminalPanel()
  const menuRef = useRef<HTMLDivElement>(null)
  const [usernameDialogOpen, setUsernameDialogOpen] = useState(false)
  const [username, setUsername] = useState('')

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [onClose])

  const handleOpenTerminal = useCallback(() => {
    onClose()
    try {
      setUsername(localStorage.getItem(`terminal-username:${data.hostId}`) ?? '')
    } catch {
      setUsername('')
    }
    setUsernameDialogOpen(true)
  }, [data.hostId, onClose])

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
  }, [username, data, openTerminal])

  return (
    <>
      <div
        ref={menuRef}
        style={{ position: 'fixed', top: y, left: x, zIndex: 9999 }}
        className="bg-popover text-popover-foreground border rounded-md shadow-md py-1 min-w-[160px]"
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          className="flex items-center w-full px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground gap-2 cursor-default"
          onClick={handleOpenTerminal}
        >
          <Terminal className="size-4 shrink-0" />
          Open Terminal
        </button>
        <div className="h-px bg-border my-1" />
        <button
          className="flex items-center w-full px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground gap-2 cursor-default"
          onClick={() => {
            router.push(`/hosts/${data.hostId}`)
            onClose()
          }}
        >
          <Server className="size-4 shrink-0" />
          View Host
        </button>
      </div>

      <Dialog open={usernameDialogOpen} onOpenChange={setUsernameDialogOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Connect to {data.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="host-ctx-username">Username</Label>
            <Input
              id="host-ctx-username"
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
}
