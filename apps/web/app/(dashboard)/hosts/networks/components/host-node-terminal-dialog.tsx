'use client'

import { useState, useCallback } from 'react'
import { KeyRound, Terminal } from 'lucide-react'
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
import {
  DEFAULT_TERMINAL_SSH_PORT,
  getTerminalSshPortStorageKey,
  normaliseTerminalSshPort,
  parseTerminalSshPort,
} from '@/lib/terminal/ssh-port'
import type { HostNodeData } from './network-flow-nodes'

interface Props {
  data: HostNodeData | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Inner form — keyed by hostId so it remounts (and re-initialises username) on each new host
function TerminalConnectForm({
  data,
  onOpenChange,
}: {
  data: HostNodeData
  onOpenChange: (open: boolean) => void
}) {
  const { openTerminal } = useTerminalPanel()
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem(`terminal-username:${data.hostId}`) ?? ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  const [portInput, setPortInput] = useState(() => {
    try {
      return String(normaliseTerminalSshPort(localStorage.getItem(getTerminalSshPortStorageKey(data.hostId))))
    } catch {
      return String(DEFAULT_TERMINAL_SSH_PORT)
    }
  })
  const [error, setError] = useState<string | null>(null)

  const handleConnect = useCallback(() => {
    const parsedPort = parseTerminalSshPort(portInput)
    if (!parsedPort.ok) {
      setError(parsedPort.error)
      return
    }
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
      username: username.trim(),
      port: parsedPort.port,
      password,
      directAccess: false,
    })
    setPassword('')
    setError(null)
    onOpenChange(false)
  }, [data, username, portInput, password, openTerminal, onOpenChange])

  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect to {data.name}</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="host-graph-username">Username</Label>
        <Input
          id="host-graph-username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
            setError(null)
          }}
          placeholder="e.g. jsmith"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && username.trim() && password && portInput.trim()) handleConnect()
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="host-graph-port">SSH Port</Label>
        <Input
          id="host-graph-port"
          type="number"
          min={1}
          max={65535}
          step={1}
          inputMode="numeric"
          value={portInput}
          onChange={(e) => {
            setPortInput(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && username.trim() && password && portInput.trim()) handleConnect()
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="host-graph-password" className="flex items-center gap-1.5">
          <KeyRound className="size-3.5" />
          Password
        </Label>
        <Input
          id="host-graph-password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(null)
          }}
          autoComplete="current-password"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && username.trim() && password && portInput.trim()) handleConnect()
          }}
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleConnect} disabled={!username.trim() || !password || !portInput.trim()}>
          <Terminal className="size-4 mr-1.5" />
          Connect
        </Button>
      </DialogFooter>
    </>
  )
}

export function HostNodeTerminalDialog({ data, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {data && (
          <TerminalConnectForm key={data.hostId} data={data} onOpenChange={onOpenChange} />
        )}
      </DialogContent>
    </Dialog>
  )
}
