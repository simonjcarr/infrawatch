const REDACTED = '[REDACTED]'
const CIRCULAR = '[Circular]'
const MAX_DEPTH = 6
const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|token|secret|authorization|cookie|session|private[_-]?key|api[_-]?key|bindpassword|config)/i

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function redactObject(
  value: Record<string, unknown>,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {}

  for (const [key, nestedValue] of Object.entries(value)) {
    safe[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : redactLogValue(nestedValue, seen, depth + 1)
  }

  return safe
}

export function redactLogValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (value == null) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (value instanceof Date) return value.toISOString()
  if (value instanceof URL) return value.toString()
  if (depth >= MAX_DEPTH) return '[Truncated]'

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, seen, depth + 1))
  }

  if (value instanceof Error) {
    return sanitiseErrorForLog(value, seen, depth + 1)
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return CIRCULAR
    seen.add(value)

    if (isPlainObject(value)) {
      return redactObject(value, seen, depth)
    }

    return redactObject({ ...value }, seen, depth)
  }

  return String(value)
}

export function sanitiseErrorForLog(
  error: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (!(error instanceof Error)) {
    return redactLogValue(error, seen, depth)
  }

  const safe: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  }

  if (typeof error.stack === 'string' && error.stack.length > 0) {
    safe.stack = error.stack
  }

  for (const [key, value] of Object.entries(error)) {
    safe[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : redactLogValue(value, seen, depth + 1)
  }

  return safe
}

export function logError(message: string, error: unknown, context?: unknown): void {
  if (context === undefined) {
    console.error(message, { error: sanitiseErrorForLog(error) })
    return
  }

  console.error(message, {
    error: sanitiseErrorForLog(error),
    context: redactLogValue(context),
  })
}

export function logWarn(message: string, error: unknown, context?: unknown): void {
  if (context === undefined) {
    console.warn(message, { error: sanitiseErrorForLog(error) })
    return
  }

  console.warn(message, {
    error: sanitiseErrorForLog(error),
    context: redactLogValue(context),
  })
}
