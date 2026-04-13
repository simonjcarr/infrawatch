'use client'

import { useState, useEffect } from 'react'
import { Terminal, User, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTerminalPanel } from '@/components/terminal'
import { useSession } from '@/lib/auth/client'
import type { HostWithAgent } from '@/lib/actions/agents'

interface Props {
  orgId: string
  host: HostWithAgent
  directAccess: boolean
  accessDeniedReason: string | null
}

export function HostTerminalLauncher({ orgId, host, directAccess, accessDeniedReason }: Props) {
  const [username, setUsername] = useState('')
  const { openTerminal } = useTerminalPanel()
  const { data: session } = useSession()

  // Pre-fill with last-used username for this host
  useEffect(() => {
    if (!session?.user?.id) return
    try {
      const saved = localStorage.getItem(`terminal-username:${session.user.id}:${host.id}`)
      if (saved) setUsername(saved)
    } catch {
      // localStorage may be unavailable
    }
  }, [session?.user?.id, host.id])

  if (accessDeniedReason) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <AlertCircle className="size-8 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-foreground">Terminal Access Denied</p>
        <p className="text-xs text-muted-foreground mt-1">{accessDeniedReason}</p>
      </div>
    )
  }

  const handleOpen = () => {
    if (!directAccess && username.trim() && session?.user?.id) {
      try {
        localStorage.setItem(`terminal-username:${session.user.id}:${host.id}`, username.trim())
      } catch {
        // localStorage may be unavailable
      }
    }
    openTerminal({
      hostId: host.id,
      hostname: host.displayName ?? host.hostname,
      username: directAccess ? null : username.trim(),
      orgId,
      directAccess,
    })
  }

  return (
    <div className="rounded-lg border border-dashed p-12 text-center space-y-4">
      <Terminal className="size-8 mx-auto text-muted-foreground" />
      <div>
        <p className="text-sm font-medium text-foreground">
          Open Terminal
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Launch an interactive shell on {host.displayName ?? host.hostname} in the terminal panel below.
        </p>
      </div>

      {directAccess ? (
        <div className="mx-auto max-w-xs">
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
            Direct access mode is enabled. You will connect with agent-level (root) privileges.
          </p>
          <Button onClick={handleOpen}>
            <Terminal className="size-4 mr-1.5" />
            Open Terminal
          </Button>
        </div>
      ) : (
        <div className="mx-auto max-w-xs space-y-3">
          <div className="text-left space-y-1.5">
            <Label htmlFor="host-terminal-username" className="text-sm">
              <User className="size-3.5 inline mr-1" />
              Username
            </Label>
            <Input
              id="host-terminal-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. jsmith"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && username.trim()) handleOpen()
              }}
            />
          </div>
          <Button onClick={handleOpen} disabled={!username.trim()}>
            <Terminal className="size-4 mr-1.5" />
            Open Terminal
          </Button>
        </div>
      )}
    </div>
  )
}
