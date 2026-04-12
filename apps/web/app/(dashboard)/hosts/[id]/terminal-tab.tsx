'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Loader2, X, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { triggerCustomScriptRun, cancelTaskRun, getTaskRun } from '@/lib/actions/task-runs'
import type { HostWithAgent } from '@/lib/actions/agents'

interface Props {
  orgId: string
  host: HostWithAgent
  userId: string
}

interface TerminalEntry {
  id: string
  command: string
  taskRunId: string | null
  output: string
  status: 'creating' | 'running' | 'success' | 'failed' | 'cancelled' | 'cancelling'
  exitCode: number | null
}

function hostStatusToEntry(hostStatus: string): TerminalEntry['status'] {
  switch (hostStatus) {
    case 'success': return 'success'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    case 'cancelling': return 'cancelling'
    default: return 'running'
  }
}

function isTerminal(status: TerminalEntry['status']): boolean {
  return status === 'success' || status === 'failed' || status === 'cancelled'
}

export function TerminalTab({ orgId, host, userId }: Props) {
  const [history, setHistory] = useState<TerminalEntry[]>([])
  const [input, setInput] = useState('')
  const [interpreter, setInterpreter] = useState<'sh' | 'bash' | 'python3'>('bash')
  const [activeTaskRunId, setActiveTaskRunId] = useState<string | null>(null)
  const [cmdHistory, setCmdHistory] = useState<string[]>([])
  const [cmdHistoryIdx, setCmdHistoryIdx] = useState(-1)

  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isRunning = activeTaskRunId !== null

  // Auto-scroll to bottom when history changes
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [history])

  // Focus input when run completes
  useEffect(() => {
    if (!isRunning) inputRef.current?.focus()
  }, [isRunning])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  /**
   * Start polling a task run. setState is called from the interval callback,
   * not synchronously inside an effect — satisfies react-hooks/set-state-in-effect.
   */
  function startPolling(taskRunId: string) {
    if (pollingRef.current) clearInterval(pollingRef.current)

    pollingRef.current = setInterval(async () => {
      const run = await getTaskRun(orgId, taskRunId)
      if (!run) return

      const hostRow = run.hosts[0]
      if (!hostRow) return

      const newStatus = hostStatusToEntry(hostRow.status)
      const exitCode = hostRow.exitCode ?? null
      const output = hostRow.rawOutput

      // setState called in interval callback — this is the allowed pattern
      setHistory((prev) =>
        prev.map((entry) =>
          entry.taskRunId === taskRunId
            ? { ...entry, output, status: newStatus, exitCode }
            : entry,
        ),
      )

      if (isTerminal(newStatus)) {
        clearInterval(pollingRef.current!)
        pollingRef.current = null
        setActiveTaskRunId(null)
      }
    }, 1_500)
  }

  const runCommand = useCallback(async () => {
    const cmd = input.trim()
    if (!cmd || isRunning) return

    const entryId = crypto.randomUUID()
    const newEntry: TerminalEntry = {
      id: entryId,
      command: cmd,
      taskRunId: null,
      output: '',
      status: 'creating',
      exitCode: null,
    }

    setHistory((prev) => [...prev, newEntry])
    setCmdHistory((prev) => [cmd, ...prev.filter((c) => c !== cmd)])
    setCmdHistoryIdx(-1)
    setInput('')

    const result = await triggerCustomScriptRun(orgId, userId, host.id, cmd, interpreter)

    if ('error' in result) {
      setHistory((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? { ...e, status: 'failed', output: `error: ${result.error}` }
            : e,
        ),
      )
      return
    }

    setHistory((prev) =>
      prev.map((e) =>
        e.id === entryId
          ? { ...e, taskRunId: result.taskRunId, status: 'running' }
          : e,
      ),
    )
    setActiveTaskRunId(result.taskRunId)
    startPolling(result.taskRunId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isRunning, orgId, userId, host.id, interpreter])

  async function handleCancel() {
    if (!activeTaskRunId) return
    await cancelTaskRun(orgId, activeTaskRunId)
    setHistory((prev) =>
      prev.map((e) =>
        e.taskRunId === activeTaskRunId ? { ...e, status: 'cancelling' } : e,
      ),
    )
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      runCommand()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const nextIdx = Math.min(cmdHistoryIdx + 1, cmdHistory.length - 1)
      setCmdHistoryIdx(nextIdx)
      setInput(cmdHistory[nextIdx] ?? '')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const nextIdx = Math.max(cmdHistoryIdx - 1, -1)
      setCmdHistoryIdx(nextIdx)
      setInput(nextIdx === -1 ? '' : (cmdHistory[nextIdx] ?? ''))
      return
    }
    if (e.key === 'c' && e.ctrlKey && isRunning) {
      e.preventDefault()
      handleCancel()
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Terminal</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Run commands on this host sequentially.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Interpreter selector */}
          <div className="flex gap-1">
            {(['sh', 'bash', 'python3'] as const).map((i) => (
              <button
                key={i}
                onClick={() => setInterpreter(i)}
                disabled={isRunning}
                className={`rounded-md border px-2.5 py-1 text-xs font-mono transition-colors ${
                  interpreter === i
                    ? 'border-primary bg-primary/5 text-foreground font-semibold'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40'
                }`}
              >
                {i}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHistory([])}
            disabled={history.length === 0}
          >
            <Trash2 className="size-3.5 mr-1.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* Terminal output */}
      <div
        ref={outputRef}
        className="rounded-lg bg-zinc-950 text-zinc-100 font-mono text-sm p-4 min-h-96 max-h-[600px] overflow-y-auto space-y-3 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {history.length === 0 && (
          <p className="text-zinc-500 text-xs">
            Type a command and press Enter to run it on {host.displayName ?? host.hostname}.
          </p>
        )}

        {history.map((entry) => (
          <div key={entry.id}>
            {/* Command line */}
            <div className="flex items-center gap-2">
              <span className="text-green-400 select-none">$</span>
              <span className="text-zinc-100">{entry.command}</span>
              {entry.status === 'creating' && (
                <Loader2 className="size-3 animate-spin text-zinc-400 ml-1" />
              )}
              {entry.status === 'running' && (
                <Loader2 className="size-3 animate-spin text-blue-400 ml-1" />
              )}
              {entry.status === 'cancelling' && (
                <span className="text-xs text-amber-400 ml-1">cancelling…</span>
              )}
            </div>

            {/* Output */}
            {entry.output && (
              <pre className="mt-1 ml-4 text-zinc-300 text-xs whitespace-pre-wrap break-words leading-relaxed">
                {entry.output}
              </pre>
            )}

            {/* Exit code / cancelled */}
            {isTerminal(entry.status) && entry.exitCode !== null && entry.exitCode !== 0 && (
              <p className="ml-4 mt-0.5 text-xs text-red-400">[exit: {entry.exitCode}]</p>
            )}
            {entry.status === 'cancelled' && (
              <p className="ml-4 mt-0.5 text-xs text-amber-400">[cancelled]</p>
            )}
          </div>
        ))}

        {/* Input line */}
        <div className="flex items-center gap-2">
          <span className="text-green-400 select-none">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            placeholder={isRunning ? 'Running… (Ctrl+C to cancel)' : ''}
            className="flex-1 bg-transparent outline-none text-zinc-100 placeholder:text-zinc-600 caret-green-400 disabled:opacity-50"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          {isRunning && (
            <button
              onClick={handleCancel}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Cancel (Ctrl+C)"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Up/Down arrows recall command history · Ctrl+C cancels the running command · Each command creates a task run visible in the Tasks tab
      </p>
    </div>
  )
}
