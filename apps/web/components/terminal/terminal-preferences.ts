'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Per-user terminal preferences persisted to localStorage. Survives across
 * browser sessions and is shared by every open terminal tab/pane.
 */
export interface TerminalPreferences {
  fontSize: number
}

export const DEFAULT_FONT_SIZE = 13
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 32

export const FONT_SIZE_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 10, label: '10 · Small' },
  { value: 12, label: '12' },
  { value: 13, label: '13 · Default' },
  { value: 14, label: '14' },
  { value: 16, label: '16 · Large' },
  { value: 18, label: '18' },
  { value: 20, label: '20 · Extra Large' },
]

const STORAGE_KEY = 'terminal-preferences'
const CHANGE_EVENT = 'terminal-preferences-change'

const DEFAULT_PREFERENCES: TerminalPreferences = {
  fontSize: DEFAULT_FONT_SIZE,
}

function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(size)))
}

function loadPreferences(): TerminalPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFERENCES
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFERENCES
    const obj = parsed as Record<string, unknown>
    const fontSize =
      typeof obj.fontSize === 'number' ? clampFontSize(obj.fontSize) : DEFAULT_FONT_SIZE
    return { fontSize }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function savePreferences(prefs: TerminalPreferences): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage may be unavailable (private mode, quota exceeded)
  }
}

/**
 * Read + update the current terminal preferences. All consumers stay in sync
 * via a custom event so that changing the value in the settings popover
 * updates every live xterm instance immediately.
 */
export function useTerminalPreferences() {
  const [prefs, setPrefs] = useState<TerminalPreferences>(() => loadPreferences())

  useEffect(() => {
    const handleChange = (e: Event) => {
      const custom = e as CustomEvent<TerminalPreferences>
      if (custom.detail) setPrefs(custom.detail)
      else setPrefs(loadPreferences())
    }
    // Same-tab updates broadcast via CustomEvent.
    window.addEventListener(CHANGE_EVENT, handleChange)
    // Cross-tab updates arrive via native storage event.
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPrefs(loadPreferences())
    }
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, handleChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const setFontSize = useCallback((size: number) => {
    const next: TerminalPreferences = { fontSize: clampFontSize(size) }
    savePreferences(next)
    window.dispatchEvent(new CustomEvent<TerminalPreferences>(CHANGE_EVENT, { detail: next }))
  }, [])

  return { preferences: prefs, setFontSize }
}
