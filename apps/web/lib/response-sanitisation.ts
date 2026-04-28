type SanitiseSchema = {
  [key: string]: 'omit' | SanitiseSchema
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function sanitise<T>(value: T, schema: SanitiseSchema): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitise(item, schema)) as T
  }

  if (!isPlainObject(value)) {
    return value
  }

  const safe: Record<string, unknown> = {}

  for (const [key, nestedValue] of Object.entries(value)) {
    const rule = schema[key]
    if (rule === 'omit') continue
    if (rule && isPlainObject(nestedValue)) {
      safe[key] = sanitise(nestedValue, rule)
      continue
    }
    if (rule && Array.isArray(nestedValue)) {
      safe[key] = nestedValue.map((item) =>
        isPlainObject(item) ? sanitise(item, rule) : item,
      )
      continue
    }

    safe[key] = nestedValue
  }

  return safe as T
}
