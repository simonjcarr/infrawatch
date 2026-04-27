'use client'

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KeyRound, Search, Server, Terminal, User, Loader2, WifiOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { listHosts } from '@/lib/actions/agents'
import { checkTerminalAccess } from '@/lib/actions/terminal'
import { useSession } from '@/lib/auth/client'
import { useTerminalPanel } from './terminal-panel-context'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
}

export function HostSelectorDialog({ open, onOpenChange, orgId }: Props) {
  const [search, setSearch] = useState('')
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const { openTerminal } = useTerminalPanel()
  const { data: session } = useSession()
  const [typedUsername, setTypedUsername] = useState<string | null>(null)
  const [password, setPassword] = useState('')

  const { data: hosts = [], isLoading } = useQuery({
    queryKey: ['hosts', orgId],
    queryFn: () => listHosts(orgId),
    enabled: open,
  })

  const filteredHosts = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return hosts.filter((h) => h.status === 'online')
    return hosts.filter(
      (h) =>
        h.status === 'online' &&
        ((h.displayName ?? h.hostname).toLowerCase().includes(q) ||
          h.hostname.toLowerCase().includes(q) ||
          (h.ipAddresses ?? []).some((ip) => ip.includes(q))),
    )
  }, [hosts, search])

  const offlineHosts = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return hosts.filter((h) => h.status !== 'online')
    return hosts.filter(
      (h) =>
        h.status !== 'online' &&
        ((h.displayName ?? h.hostname).toLowerCase().includes(q) ||
          h.hostname.toLowerCase().includes(q) ||
          (h.ipAddresses ?? []).some((ip) => ip.includes(q))),
    )
  }, [hosts, search])

  const selectedHost = hosts.find((h) => h.id === selectedHostId)

  const { data: terminalAccess, isLoading: accessLoading } = useQuery({
    queryKey: ['terminal-access', orgId, selectedHostId],
    queryFn: () => checkTerminalAccess(orgId, selectedHostId!),
    enabled: !!selectedHostId,
  })

  const directAccess = false

  // Read last-used username from localStorage via useSyncExternalStore so
  // the impure read happens inside the store snapshot, not during render.
  const storageKey =
    session?.user?.id && selectedHostId
      ? `terminal-username:${session.user.id}:${selectedHostId}`
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

  const username = typedUsername ?? savedUsername

  const handleConnect = async () => {
    if (!selectedHost) return

    if (!terminalAccess?.allowed) {
      setError(terminalAccess && 'reason' in terminalAccess ? terminalAccess.reason : 'Terminal access denied')
      return
    }

    if (!username.trim()) {
      setError('Username is required for SSH terminal access')
      return
    }
    if (!password) {
      setError('Password is required for SSH terminal access')
      return
    }

    setConnecting(true)
    setError(null)

    // Save last-used username for this host
    if (username.trim() && session?.user?.id && selectedHostId) {
      try {
        localStorage.setItem(`terminal-username:${session.user.id}:${selectedHostId}`, username.trim())
      } catch {
        // localStorage may be unavailable
      }
    }

    openTerminal({
      hostId: selectedHost.id,
      hostname: selectedHost.displayName ?? selectedHost.hostname,
      username: username.trim(),
      password,
      orgId,
      directAccess: false,
    })

    // Reset state and close
    setSearch('')
    setSelectedHostId(null)
    setTypedUsername(null)
    setPassword('')
    setError(null)
    setConnecting(false)
    onOpenChange(false)
  }

  const handleBack = () => {
    setSelectedHostId(null)
    setTypedUsername(null)
    setPassword('')
    setError(null)
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSearch('')
      setSelectedHostId(null)
      setTypedUsername(null)
      setPassword('')
      setError(null)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="size-4" />
            {selectedHostId ? 'Connect to Terminal' : 'Open Terminal'}
          </DialogTitle>
          <DialogDescription>
            {selectedHostId
              ? `Connect to ${selectedHost?.displayName ?? selectedHost?.hostname}`
              : 'Select a host to open a terminal session'}
          </DialogDescription>
        </DialogHeader>

        {!selectedHostId ? (
          // Step 1: Host selection
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search hosts by name or IP..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                autoFocus
              />
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border divide-y">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredHosts.length === 0 && offlineHosts.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {search ? 'No hosts match your search' : 'No hosts available'}
                </div>
              ) : (
                <>
                  {filteredHosts.map((host) => (
                    <button
                      key={host.id}
                      className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedHostId(host.id)}
                    >
                      <Server className="size-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {host.displayName ?? host.hostname}
                        </p>
                        {host.displayName && host.displayName !== host.hostname && (
                          <p className="text-xs text-muted-foreground truncate">{host.hostname}</p>
                        )}
                      </div>
                      <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-xs shrink-0">
                        Online
                      </Badge>
                    </button>
                  ))}
                  {offlineHosts.map((host) => (
                    <div
                      key={host.id}
                      className="flex items-center gap-3 w-full px-3 py-2.5 opacity-50 cursor-not-allowed"
                    >
                      <WifiOff className="size-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {host.displayName ?? host.hostname}
                        </p>
                      </div>
                      <Badge className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100 text-xs shrink-0">
                        Offline
                      </Badge>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        ) : (
          // Step 2: Username input (or direct connect confirmation)
          <div className="space-y-4">
            {accessLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : terminalAccess && !terminalAccess.allowed ? (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-3 text-sm text-destructive">
                {'reason' in terminalAccess ? terminalAccess.reason : 'Terminal access denied for this host'}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="host-selector-username" className="text-sm font-medium">
                    <User className="size-3.5 inline mr-1.5" />
                    Username
                  </Label>
                  <Input
                    id="host-selector-username"
                    value={username}
                    onChange={(e) => {
                      setTypedUsername(e.target.value)
                      setError(null)
                    }}
                    placeholder="e.g. jsmith"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="host-selector-password" className="text-sm font-medium">
                    <KeyRound className="size-3.5 inline mr-1.5" />
                    Password
                  </Label>
                  <Input
                    id="host-selector-password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      setError(null)
                    }}
                    autoComplete="current-password"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && username.trim() && password) handleConnect()
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter a username and password that exist on the selected host.
                  </p>
                </div>

                {error && (
                  <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {selectedHostId && (
            <Button variant="outline" onClick={handleBack} className="mr-auto">
              Back
            </Button>
          )}
          {selectedHostId && terminalAccess?.allowed && (
            <Button
              onClick={handleConnect}
              disabled={connecting || !username.trim() || !password}
            >
              {connecting ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <Terminal className="size-4 mr-1.5" />
              )}
              Connect
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
