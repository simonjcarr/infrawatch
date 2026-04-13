'use client'

import { useRef, useEffect, useCallback } from 'react'
import { createTerminalSession } from '@/lib/actions/terminal'
import type { TerminalTabInfo } from './terminal-panel-context'

type Status = 'connecting' | 'connected' | 'error' | 'closed'

interface Props {
  tab: TerminalTabInfo
  isVisible: boolean
  onStatusChange?: (tabId: string, status: Status) => void
}

export function TerminalSession({ tab, isVisible, onStatusChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<unknown>(null)
  const fitRef = useRef<unknown>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const connectionCleanupRef = useRef<(() => void) | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const hasInitializedRef = useRef(false)

  const updateStatus = useCallback(
    (s: Status) => {
      onStatusChange?.(tab.id, s)
    },
    [tab.id, onStatusChange],
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

        // Tear down previous WebSocket connection if any
        connectionCleanupRef.current?.()
        connectionCleanupRef.current = null

        updateStatus('connecting')
        term.clear()

        const connectMsg = tab.directAccess
          ? `Connecting to ${tab.hostname}...`
          : `Connecting to ${tab.hostname} as ${tab.username}...`
        term.writeln(`\x1b[90m${connectMsg}\x1b[0m`)

        const result = await createTerminalSession(
          tab.orgId,
          tab.hostId,
          tab.directAccess ? undefined : (tab.username ?? undefined),
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

        const ws = new WebSocket(result.ingestWsUrl)
        wsRef.current = ws

        let agentDidConnect = false
        let sessionEnded = false
        const waitingTimer = setTimeout(() => {
          if (!agentDidConnect) {
            term.writeln('\x1b[33mWaiting for agent to start shell...\x1b[0m')
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
          updateStatus('connected')
          term.writeln('\x1b[32mConnected to ingest. Waiting for agent...\x1b[0m')
          fitAddon.fit()
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
          }
          term.focus()
        }

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type === 'agent_connected') {
              agentDidConnect = true
              clearTimeout(waitingTimer)
              term.writeln('\x1b[32mAgent connected. Starting shell...\x1b[0m\r\n')
            } else if (msg.type === 'output' && msg.data) {
              if (!agentDidConnect) {
                agentDidConnect = true
                clearTimeout(waitingTimer)
              }
              term.write(atob(msg.data))
            } else if (msg.type === 'closed') {
              clearTimeout(waitingTimer)
              term.writeln('\r\n\x1b[90mSession ended.\x1b[0m')
              updateStatus('closed')
              promptReconnect()
            } else if (msg.type === 'diagnostic' && msg.message) {
              term.writeln(`\x1b[90m[diag] ${msg.message}\x1b[0m`)
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
            ws.close(1000, 'tab closed')
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
  }, [tab, updateStatus])

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-zinc-950"
      style={{
        display: isVisible ? 'block' : 'none',
        padding: '4px',
      }}
    />
  )
}
