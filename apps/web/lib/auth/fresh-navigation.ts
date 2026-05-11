'use client'

export function navigateWithFreshDocument(path: string, mode: 'assign' | 'replace' = 'assign'): void {
  if (mode === 'replace') {
    window.location.replace(path)
    return
  }

  window.location.assign(path)
}
