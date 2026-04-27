'use client'

import { useRef, useEffect, useCallback } from 'react'
import { createTerminalSession } from '@/lib/actions/terminal'
import type { TerminalSessionBinding } from './terminal-panel-context'

export type TerminalSessionStatus = 'connecting' | 'connected' | 'error' | 'closed'

interface Props {
  paneId: string
  binding: TerminalSessionBinding
  isVisible: boolean
  isFocused: boolean
  fontSize: number
  onStatusChange?: (paneId: string, status: TerminalSessionStatus) => void
  onFocus?: () => void
}

export function TerminalSession({
  paneId,
  binding,
  isVisible,
  isFocused,
  fontSize,
  onStatusChange,
  onFocus,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<unknown>(null)
  const fitRef = useRef<unknown>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const connectionCleanupRef = useRef<(() => void) | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const hasInitializedRef = useRef(false)
  // Hold the latest font size so the init effect doesn't need it in its deps.
  const fontSizeRef = useRef(fontSize)
  useEffect(() => {
    fontSizeRef.current = fontSize
  }, [fontSize])

  const updateStatus = useCallback(
    (s: TerminalSessionStatus) => {
      onStatusChange?.(paneId, s)
    },
    [paneId, onStatusChange],
  )

  // Refit when visibility changes
  useEffect(() => {
    if (isVisible && fitRef.current) {
      const fit = fitRef.current as { fit: () => void }
      requestAnimationFrame(() => {
        try {
          fit.fit()
        } catch {
          // ignore
        }
      })
    }
  }, [isVisible])

  // Focus the xterm when this pane becomes the active one.
  useEffect(() => {
    if (isFocused && isVisible && termRef.current) {
      const term = termRef.current as { focus: () => void }
      try {
        term.focus()
      } catch {
        // ignore
      }
    }
  }, [isFocused, isVisible])

  // Apply font-size changes to a live terminal instance and re-fit.
  useEffect(() => {
    if (!termRef.current) return
    const term = termRef.current as { options: { fontSize?: number } }
    if (term.options.fontSize === fontSize) return
    try {
      term.options.fontSize = fontSize
      const fit = fitRef.current as { fit: () => void } | null
      requestAnimationFrame(() => {
        try {
          fit?.fit()
        } catch {
          // ignore
        }
      })
    } catch {
      // ignore
    }
  }, [fontSize])

  // Initialize terminal and start first connection
  useEffect(() => {
    if (hasInitializedRef.current) return
    hasInitializedRef.current = true

    let cancelled = false

    const init = async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ])
      await import('@xterm/xterm/css/xterm.css')

      if (cancelled || !containerRef.current) return

      containerRef.current.innerHTML = ''

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: fontSizeRef.current,
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

      requestAnimationFrame(() => {
        fitAddon.fit()
      })

      // Resize observer persists across reconnections
      if (containerRef.current) {
        const observer = new ResizeObserver(() => {
          try {
            fitAddon.fit()
          } catch {
            // ignore
          }
        })
        observer.observe(containerRef.current)
        resizeObserverRef.current = observer
      }

      // Reconnectable session — called on initial mount and after exit/error
      const connectSession = async () => {
        if (cancelled) return

        connectionCleanupRef.current?.()
        connectionCleanupRef.current = null

        updateStatus('connecting')
        term.clear()

        if (!binding.password) {
          term.writeln('\x1b[31mError: host password is required. Open a new terminal session.\x1b[0m')
          updateStatus('error')
          return
        }

        term.writeln(`\x1b[90mConnecting to ${binding.hostname} as ${binding.username} over SSH...\x1b[0m`)

        const result = await createTerminalSession(
          binding.orgId,
          binding.hostId,
          binding.username,
        )

        if (cancelled) return

        if ('error' in result) {
          term.writeln(`\r\n\x1b[31mError: ${result.error}\x1b[0m`)
          term.writeln('\r\n\x1b[90mPress any key to retry...\x1b[0m')
          updateStatus('error')
          const retryDisposable = term.onData(() => {
            retryDisposable.dispose()
            connectSession()
          })
          return
        }

        // A path-only ingestWsUrl (e.g. "/ws/terminal/...") means "use the
        // same origin as the page" — required for reverse-proxy / tunnel
        // deployments where the ingest service is not directly reachable.
        const wsUrl = result.ingestWsUrl.startsWith('/')
          ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${result.ingestWsUrl}`
          : result.ingestWsUrl
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        let sshDidConnect = false
        let sessionEnded = false
        const waitingTimer = setTimeout(() => {
          if (!sshDidConnect) {
            term.writeln('\x1b[33mWaiting for SSH authentication...\x1b[0m')
          }
        }, 5000)

        const promptReconnect = () => {
          if (sessionEnded) return
          sessionEnded = true
          term.writeln('\r\n\x1b[90mPress any key to reconnect...\x1b[0m')
          const reconnectDisposable = term.onData(() => {
            reconnectDisposable.dispose()
            connectSession()
          })
        }

        ws.onopen = () => {
          term.writeln('\x1b[32mConnected to CTOps. Opening SSH session...\x1b[0m')
          fitAddon.fit()
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'auth',
              token: result.websocketToken,
              password: binding.password,
            }))
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
          }
          term.focus()
        }

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type === 'ssh_connected' || msg.type === 'agent_connected') {
              sshDidConnect = true
              clearTimeout(waitingTimer)
              updateStatus('connected')
              term.writeln('\x1b[32mSSH connected. Starting shell...\x1b[0m\r\n')
            } else if (msg.type === 'output' && msg.data) {
              if (!sshDidConnect) {
                sshDidConnect = true
                clearTimeout(waitingTimer)
                updateStatus('connected')
              }
              term.write(atob(msg.data))
            } else if (msg.type === 'closed') {
              clearTimeout(waitingTimer)
              term.writeln('\r\n\x1b[90mSession ended.\x1b[0m')
              updateStatus('closed')
              promptReconnect()
            } else if (msg.type === 'error' && msg.message) {
              clearTimeout(waitingTimer)
              term.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`)
              updateStatus('error')
              promptReconnect()
            }
          } catch {
            // ignore malformed messages
          }
        }

        ws.onerror = () => {
          updateStatus('error')
        }

        ws.onclose = (e) => {
          if (e.code !== 1000) {
            updateStatus('closed')
            promptReconnect()
          }
        }

        const dataDisposable = term.onData((data: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data: btoa(data) }))
          }
        })

        const resizeDisposable = term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols, rows }))
          }
        })

        connectionCleanupRef.current = () => {
          clearTimeout(waitingTimer)
          dataDisposable.dispose()
          resizeDisposable.dispose()
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            try {
              ws.send(JSON.stringify({ type: 'close' }))
            } catch {
              // ignore send errors on closing socket
            }
            ws.close(1000, 'pane closed')
          }
          wsRef.current = null
        }
      }

      connectSession()
    }

    init()

    return () => {
      cancelled = true
      connectionCleanupRef.current?.()
      connectionCleanupRef.current = null
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      const term = termRef.current as { dispose: () => void } | null
      term?.dispose()
      termRef.current = null
      fitRef.current = null
      wsRef.current = null
    }
  }, [binding, updateStatus])

  return (
    <div
      onMouseDown={onFocus}
      className="h-full w-full bg-zinc-950"
      style={{
        display: isVisible ? 'block' : 'none',
        padding: '4px',
      }}
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
