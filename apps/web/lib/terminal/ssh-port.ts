export const DEFAULT_TERMINAL_SSH_PORT = 22
export const MIN_TERMINAL_SSH_PORT = 1
export const MAX_TERMINAL_SSH_PORT = 65535

export type TerminalSshPortParseResult =
  | { ok: true; port: number }
  | { ok: false; error: string }

export function parseTerminalSshPort(input: string): TerminalSshPortParseResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return { ok: false, error: 'SSH port is required' }
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    return { ok: false, error: 'SSH port must be a whole number' }
  }

  const port = Number(trimmed)
  if (!Number.isSafeInteger(port) || port < MIN_TERMINAL_SSH_PORT || port > MAX_TERMINAL_SSH_PORT) {
    return { ok: false, error: 'SSH port must be between 1 and 65535' }
  }

  return { ok: true, port }
}

export function normaliseTerminalSshPort(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value >= MIN_TERMINAL_SSH_PORT && value <= MAX_TERMINAL_SSH_PORT
      ? value
      : DEFAULT_TERMINAL_SSH_PORT
  }

  if (typeof value === 'string') {
    const parsed = parseTerminalSshPort(value)
    return parsed.ok ? parsed.port : DEFAULT_TERMINAL_SSH_PORT
  }

  return DEFAULT_TERMINAL_SSH_PORT
}

export function getTerminalSshPortStorageKey(hostId: string): string {
  return `terminal-ssh-port:${hostId}`
}
