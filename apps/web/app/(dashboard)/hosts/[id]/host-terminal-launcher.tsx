'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import { KeyRound, Terminal, User, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTerminalPanel } from '@/components/terminal'
import { useSession } from '@/lib/auth/client'
import {
  DEFAULT_TERMINAL_SSH_PORT,
  getTerminalSshPortStorageKey,
  normaliseTerminalSshPort,
  parseTerminalSshPort,
} from '@/lib/terminal/ssh-port'
import type { HostWithAgent } from '@/lib/actions/agents-core'

interface Props {
  host: HostWithAgent
  directAccess: boolean
  accessDeniedReason: string | null
}

export function HostTerminalLauncher({ host, directAccess, accessDeniedReason }: Props) {
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

  const portStorageKey = getTerminalSshPortStorageKey(host.id)
  const subscribePort = useCallback((onChange: () => void) => {
    if (typeof window === 'undefined') return () => {}
    const handler = (e: StorageEvent) => {
      if (e.key === portStorageKey) onChange()
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [portStorageKey])
  const getPortSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return String(DEFAULT_TERMINAL_SSH_PORT)
    try {
      return String(normaliseTerminalSshPort(localStorage.getItem(portStorageKey)))
    } catch {
      return String(DEFAULT_TERMINAL_SSH_PORT)
    }
  }, [portStorageKey])
  const savedPortInput = useSyncExternalStore(subscribePort, getPortSnapshot, () => String(DEFAULT_TERMINAL_SSH_PORT))

  const [typedUsername, setTypedUsername] = useState<string | null>(null)
  const [typedPortInput, setTypedPortInput] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const username = typedUsername ?? savedUsername
  const portInput = typedPortInput ?? savedPortInput

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
    const parsedPort = parseTerminalSshPort(portInput)
    if (!parsedPort.ok) {
      setError(parsedPort.error)
      return
    }

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
      port: parsedPort.port,
      password,
      directAccess: false,
    })
    setPassword('')
    setError(null)
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
            onChange={(e) => {
              setTypedUsername(e.target.value)
              setError(null)
            }}
            placeholder="e.g. jsmith"
          />
        </div>
        <div className="text-left space-y-1.5">
          <Label htmlFor="host-terminal-port" className="text-sm">
            SSH Port
          </Label>
          <Input
            id="host-terminal-port"
            type="number"
            min={1}
            max={65535}
            step={1}
            inputMode="numeric"
            value={portInput}
            onChange={(e) => {
              setTypedPortInput(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && username.trim() && password && portInput.trim()) handleOpen()
            }}
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
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && username.trim() && password && portInput.trim()) handleOpen()
            }}
          />
        </div>
        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-left text-sm text-destructive">
            {error}
          </div>
        )}
        <Button onClick={handleOpen} disabled={!username.trim() || !password || !portInput.trim()}>
          <Terminal className="size-4 mr-1.5" />
          Open Terminal
        </Button>
      </div>
    </div>
  )
}
