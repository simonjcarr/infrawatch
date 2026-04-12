'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, PlugZap, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createTerminalSession } from '@/lib/actions/terminal'
import type { HostWithAgent } from '@/lib/actions/agents'

interface Props {
  orgId: string
  host: HostWithAgent
  userId: string
}

type Status = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

export function TerminalTab({ orgId, host }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<unknown>(null)
  const fitRef = useRef<unknown>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  const connect = useCallback(async () => {
    // Clean up previous session
    cleanupRef.current?.()
    cleanupRef.current = null

    setStatus('connecting')
    setErrorMsg(null)

    // Create session via server action (access control + DB record)
    const result = await createTerminalSession(orgId, host.id)
    if ('error' in result) {
      setStatus('error')
      setErrorMsg(result.error)
      return
    }

    // Dynamic import xterm.js (not SSR-safe)
    const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-web-links'),
    ])

    // Also import xterm CSS dynamically
    await import('@xterm/xterm/css/xterm.css')

    if (!containerRef.current) {
      setStatus('error')
      setErrorMsg('Terminal container not found')
      return
    }

    // Clear container from any previous session
    containerRef.current.innerHTML = ''

    // Init xterm.js
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      theme: {
        background: '#09090b',
        foreground: '#e4e4e7',
        cursor: '#22c55e',
        selectionBackground: '#27272a',
      },
    })
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)
    termRef.current = term
    fitRef.current = fitAddon

    // Defer fit to next frame so the container is visible (display: block)
    // after React processes the 'connecting' status. Without this, fit()
    // calculates 0 cols/rows because the container is still display: none.
    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    term.writeln('\x1b[90mConnecting to ' + (host.displayName ?? host.hostname) + '...\x1b[0m')

    // Open WebSocket to ingest
    const ws = new WebSocket(result.ingestWsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      term.writeln('\x1b[32mConnected.\x1b[0m\r\n')
      // Send initial size — fit has already run by now so cols/rows are correct
      fitAddon.fit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
      term.focus()
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'output' && msg.data) {
          term.write(atob(msg.data))
        } else if (msg.type === 'closed') {
          term.writeln('\r\n\x1b[90mSession ended.\x1b[0m')
          setStatus('closed')
        } else if (msg.type === 'error' && msg.message) {
          term.writeln('\r\n\x1b[31mError: ' + msg.message + '\x1b[0m')
          setStatus('error')
          setErrorMsg(msg.message)
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onerror = () => {
      setStatus('error')
      setErrorMsg('WebSocket connection error')
    }

    ws.onclose = (e) => {
      if (e.code !== 1000) {
        // Abnormal close
        setStatus((prev) => (prev === 'error' ? prev : 'closed'))
      }
    }

    // Forward keystrokes to server
    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data: btoa(data) }))
      }
    })

    // Handle resize
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    // Observe container resizes and refit terminal
    let resizeObserver: ResizeObserver | null = null
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit()
        } catch {
          // ignore errors during cleanup
        }
      })
      resizeObserver.observe(containerRef.current)
    }

    // Cleanup function
    cleanupRef.current = () => {
      dataDisposable.dispose()
      resizeDisposable.dispose()
      resizeObserver?.disconnect()
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.send(JSON.stringify({ type: 'close' }))
        ws.close(1000, 'user disconnected')
      }
      term.dispose()
      termRef.current = null
      fitRef.current = null
      wsRef.current = null
    }
  }, [orgId, host.id, host.displayName, host.hostname])

  const disconnect = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setStatus('closed')
  }, [])

  const showTerminal = status === 'connecting' || status === 'connected' || status === 'closed'

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Terminal</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Interactive shell on {host.displayName ?? host.hostname}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status === 'connected' && (
            <Button variant="outline" size="sm" onClick={disconnect}>
              <Unplug className="size-3.5 mr-1.5" />
              Disconnect
            </Button>
          )}
          {(status === 'idle' || status === 'closed' || status === 'error') && (
            <Button size="sm" onClick={connect}>
              <PlugZap className="size-3.5 mr-1.5" />
              {status === 'idle' ? 'Connect' : 'Reconnect'}
            </Button>
          )}
          {status === 'connecting' && (
            <Button size="sm" disabled>
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              Connecting...
            </Button>
          )}
        </div>
      </div>

      {/* Error message */}
      {errorMsg && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 rounded-md px-3 py-2 border border-destructive/20">
          <AlertCircle className="size-4 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Terminal container - always rendered so xterm can attach */}
      <div
        ref={containerRef}
        className="rounded-lg overflow-hidden bg-zinc-950 border border-border"
        style={{
          height: '500px',
          display: showTerminal ? 'block' : 'none',
          padding: '4px',
        }}
      />

      {/* Placeholder state — shown only when idle (terminal container is hidden) */}
      {!showTerminal && !errorMsg && (
        <div className="rounded-lg bg-zinc-950 border border-border flex items-center justify-center" style={{ height: '500px' }}>
          <p className="text-zinc-500 text-sm">Click Connect to start a terminal session</p>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className={`size-2 rounded-full ${
          status === 'connected' ? 'bg-green-500' :
          status === 'connecting' ? 'bg-amber-500 animate-pulse' :
          status === 'error' ? 'bg-red-500' :
          'bg-zinc-500'
        }`} />
        {status === 'connected' && 'Connected'}
        {status === 'idle' && 'Not connected'}
        {status === 'connecting' && 'Connecting...'}
        {status === 'closed' && 'Disconnected'}
        {status === 'error' && 'Connection error'}
      </div>
    </div>
  )
}
