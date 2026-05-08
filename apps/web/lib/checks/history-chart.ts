export const CHECK_STATUS_COLOURS = {
  pass: '#22c55e',
  fail: '#ef4444',
  error: '#f59e0b',
  unknown: '#9ca3af',
} as const

const PATCH_STATUS_AMBER_RATIO = 5 / 6

type PatchStatusPayload = {
  patch_age_days?: unknown
  max_age_days?: unknown
  updates_count?: unknown
}

export function parsePatchStatusOutput(output: string | null | undefined): PatchStatusPayload | null {
  if (!output) return null
  try {
    const parsed = JSON.parse(output) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as PatchStatusPayload
  } catch {
    return null
  }
}

function finiteNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, value)
}

export function getPatchStatusChartValue(output: string | null | undefined): number {
  return finiteNonNegativeNumber(parsePatchStatusOutput(output)?.updates_count) ?? 0
}

export function getPatchStatusChartColour(
  output: string | null | undefined,
  configuredMaxAgeDays?: number,
): string {
  const payload = parsePatchStatusOutput(output)
  const patchAgeDays = finiteNonNegativeNumber(payload?.patch_age_days)
  const maxAgeDays = finiteNonNegativeNumber(payload?.max_age_days) ?? finiteNonNegativeNumber(configuredMaxAgeDays)

  if (patchAgeDays === null || maxAgeDays === null || maxAgeDays <= 0) {
    return CHECK_STATUS_COLOURS.unknown
  }

  if (patchAgeDays > maxAgeDays) {
    return CHECK_STATUS_COLOURS.fail
  }

  if (patchAgeDays >= maxAgeDays * PATCH_STATUS_AMBER_RATIO) {
    return CHECK_STATUS_COLOURS.error
  }

  return CHECK_STATUS_COLOURS.pass
}
