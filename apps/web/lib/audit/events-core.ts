type AuditScalar = string | number | boolean | null
export type AuditJson = AuditScalar | AuditJson[] | { [key: string]: AuditJson }

export interface AuditEventInput {
  organisationId: string
  actorUserId: string
  action: string
  targetType: string
  targetId?: string | null
  summary: string
  metadata?: unknown
}

function serialiseAuditValue(value: unknown): AuditJson | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return value
      .map((entry) => serialiseAuditValue(entry))
      .filter((entry): entry is AuditJson => entry !== undefined)
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    }
  }
  if (typeof value === 'object') {
    const out: Record<string, AuditJson> = {}
    for (const [key, entry] of Object.entries(value)) {
      const serialised = serialiseAuditValue(entry)
      if (serialised !== undefined) {
        out[key] = serialised
      }
    }
    return out
  }
  return undefined
}

export function serialiseAuditMetadata(metadata: unknown): AuditJson | undefined {
  const serialised = serialiseAuditValue(metadata)
  if (serialised == null) return undefined
  return serialised
}

export function buildAuditEventValues(input: AuditEventInput) {
  return {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    summary: input.summary,
    metadata: serialiseAuditMetadata(input.metadata) ?? null,
  }
}
