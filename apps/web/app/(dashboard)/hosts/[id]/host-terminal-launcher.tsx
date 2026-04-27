'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import { KeyRound, Terminal, User, AlertCircle } from 'lucide-react'
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
  const { openTerminal } = useTerminalPanel()
  const { data: session } = useSession()

  // Read last-used username from localStorage via useSyncExternalStore so
  // the impure read happens inside the store snapshot, not during render.
  const storageKey = session?.user?.id
    ? `terminal-username:${session.user.id}:${host.id}`
    : null
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === 'undefined') return () => {}
    const handler = (e: StorageEvent) => {
      if (!storageKey || e.key === storageKey) onChange()
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [storageKey])
  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !storageKey) return ''
    try {
      return localStorage.getItem(storageKey) ?? ''
    } catch {
      return ''
    }
  }, [storageKey])
  const savedUsername = useSyncExternalStore(subscribe, getSnapshot, () => '')

  const [typedUsername, setTypedUsername] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const username = typedUsername ?? savedUsername

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
      username: username.trim(),
      password,
      orgId,
      directAccess: false,
    })
    setPassword('')
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

      <div className="mx-auto max-w-xs space-y-3">
        <div className="text-left space-y-1.5">
          <Label htmlFor="host-terminal-username" className="text-sm">
            <User className="size-3.5 inline mr-1" />
            Username
          </Label>
          <Input
            id="host-terminal-username"
            value={username}
            onChange={(e) => setTypedUsername(e.target.value)}
            placeholder="e.g. jsmith"
          />
        </div>
        <div className="text-left space-y-1.5">
          <Label htmlFor="host-terminal-password" className="text-sm">
            <KeyRound className="size-3.5 inline mr-1" />
            Password
          </Label>
          <Input
            id="host-terminal-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && username.trim() && password) handleOpen()
            }}
          />
        </div>
        <Button onClick={handleOpen} disabled={!username.trim() || !password}>
          <Terminal className="size-4 mr-1.5" />
          Open Terminal
        </Button>
      </div>
    </div>
  )
}
