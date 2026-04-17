'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { createId } from '@paralleldrive/cuid2'

export type TerminalTabColor =
  | 'slate'
  | 'red'
  | 'amber'
  | 'emerald'
  | 'sky'
  | 'violet'
  | 'pink'

/**
 * Identity used to establish a terminal session (host + user).
 * Splits always reuse the parent tab's binding so new panes connect to the same host.
 */
export interface TerminalSessionBinding {
  hostId: string
  hostname: string
  username: string | null
  orgId: string
  directAccess: boolean
}

export type TerminalPaneNode =
  | { type: 'leaf'; id: string }
  | {
      type: 'split'
      id: string
      direction: 'row' | 'column'
      ratio: number
      children: [TerminalPaneNode, TerminalPaneNode]
    }

export interface TerminalTabInfo {
  id: string
  binding: TerminalSessionBinding
  color: TerminalTabColor | null
  label: string | null
  paneTree: TerminalPaneNode
  activePaneId: string
  /** Optional per-tab font-size override. When null, the global preference is used. */
  fontSize: number | null
}

interface TerminalPanelState {
  isOpen: boolean
  panelHeight: number
  tabs: TerminalTabInfo[]
  activeTabId: string | null
}

interface TerminalPanelActions {
  openTerminal: (params: {
    hostId: string
    hostname: string
    username: string | null
    orgId: string
    directAccess: boolean
  }) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  togglePanel: () => void
  openPanel: () => void
  closePanel: () => void
  setPanelHeight: (height: number) => void
  reorderTabs: (fromTabId: string, toTabId: string) => void
  setTabColor: (tabId: string, color: TerminalTabColor | null) => void
  renameTab: (tabId: string, label: string) => void
  splitPane: (tabId: string, paneId: string, direction: 'row' | 'column') => void
  closePane: (tabId: string, paneId: string) => void
  setActivePane: (tabId: string, paneId: string) => void
  setSplitRatio: (tabId: string, splitId: string, ratio: number) => void
  setTabFontSize: (tabId: string, fontSize: number | null) => void
}

type TerminalPanelContextValue = TerminalPanelState & TerminalPanelActions

const TerminalPanelContext = createContext<TerminalPanelContextValue | null>(null)

const DEFAULT_PANEL_HEIGHT = 350
const MIN_PANEL_HEIGHT = 150
const MAX_PANEL_HEIGHT_RATIO = 0.7

// --- pane tree helpers ---

function findFirstLeafId(node: TerminalPaneNode): string {
  return node.type === 'leaf' ? node.id : findFirstLeafId(node.children[0])
}

function mapPaneTree(
  node: TerminalPaneNode,
  leafId: string,
  replacer: (leaf: { type: 'leaf'; id: string }) => TerminalPaneNode,
): TerminalPaneNode {
  if (node.type === 'leaf') {
    return node.id === leafId ? replacer(node) : node
  }
  return {
    ...node,
    children: [
      mapPaneTree(node.children[0], leafId, replacer),
      mapPaneTree(node.children[1], leafId, replacer),
    ],
  }
}

function removeLeafFromTree(
  node: TerminalPaneNode,
  leafId: string,
): TerminalPaneNode | null {
  if (node.type === 'leaf') {
    return node.id === leafId ? null : node
  }
  const left = removeLeafFromTree(node.children[0], leafId)
  const right = removeLeafFromTree(node.children[1], leafId)
  if (left && right) {
    return { ...node, children: [left, right] }
  }
  return left ?? right ?? null
}

function setSplitRatioInTree(
  node: TerminalPaneNode,
  splitId: string,
  ratio: number,
): TerminalPaneNode {
  if (node.type === 'leaf') return node
  if (node.id === splitId) {
    return { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) }
  }
  return {
    ...node,
    children: [
      setSplitRatioInTree(node.children[0], splitId, ratio),
      setSplitRatioInTree(node.children[1], splitId, ratio),
    ],
  }
}

function isValidPaneTree(value: unknown): value is TerminalPaneNode {
  if (typeof value !== 'object' || value === null) return false
  const n = value as Record<string, unknown>
  if (n.type === 'leaf') return typeof n.id === 'string'
  if (n.type === 'split') {
    if (typeof n.id !== 'string') return false
    if (n.direction !== 'row' && n.direction !== 'column') return false
    if (typeof n.ratio !== 'number') return false
    if (!Array.isArray(n.children) || n.children.length !== 2) return false
    return isValidPaneTree(n.children[0]) && isValidPaneTree(n.children[1])
  }
  return false
}

// --- sessionStorage persistence ---

const STORAGE_KEY = 'terminal-panel-state'

interface PersistedTab {
  binding: TerminalSessionBinding
  color: TerminalTabColor | null
  label: string | null
  paneTree: TerminalPaneNode
  fontSize: number | null
}

interface PersistedTerminalState {
  tabs: PersistedTab[]
  activeTabIndex: number | null
  isOpen: boolean
  panelHeight: number
}

const COLOR_VALUES = new Set<TerminalTabColor>([
  'slate',
  'red',
  'amber',
  'emerald',
  'sky',
  'violet',
  'pink',
])

function isValidBinding(value: unknown): value is TerminalSessionBinding {
  if (typeof value !== 'object' || value === null) return false
  const b = value as Record<string, unknown>
  return (
    typeof b.hostId === 'string' &&
    typeof b.hostname === 'string' &&
    (b.username === null || typeof b.username === 'string') &&
    typeof b.orgId === 'string' &&
    typeof b.directAccess === 'boolean'
  )
}

function isValidPersistedTab(value: unknown): value is PersistedTab {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Record<string, unknown>
  if (!isValidBinding(t.binding)) return false
  if (t.color !== null && !COLOR_VALUES.has(t.color as TerminalTabColor)) return false
  if (t.label !== null && typeof t.label !== 'string') return false
  if (!isValidPaneTree(t.paneTree)) return false
  // fontSize may be absent on state from older builds — accept null/missing/number.
  if (
    t.fontSize !== undefined &&
    t.fontSize !== null &&
    (typeof t.fontSize !== 'number' || !Number.isFinite(t.fontSize))
  ) {
    return false
  }
  return true
}

function isValidPersistedState(value: unknown): value is PersistedTerminalState {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (typeof obj.isOpen !== 'boolean') return false
  if (typeof obj.panelHeight !== 'number' || !Number.isFinite(obj.panelHeight)) return false
  if (obj.activeTabIndex !== null && typeof obj.activeTabIndex !== 'number') return false
  if (!Array.isArray(obj.tabs)) return false
  return obj.tabs.every(isValidPersistedTab)
}

function loadPersistedState(): TerminalPanelState | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isValidPersistedState(parsed)) return null
    if (parsed.tabs.length === 0) return null

    const tabs: TerminalTabInfo[] = parsed.tabs.map((t) => ({
      id: createId(),
      binding: t.binding,
      color: t.color,
      label: t.label,
      paneTree: t.paneTree,
      activePaneId: findFirstLeafId(t.paneTree),
      fontSize: typeof t.fontSize === 'number' ? t.fontSize : null,
    }))

    const restoredTab =
      parsed.activeTabIndex !== null ? tabs[parsed.activeTabIndex] : undefined
    const activeTabId = restoredTab?.id ?? tabs[0]?.id ?? null

    return {
      tabs,
      activeTabId,
      isOpen: parsed.isOpen,
      panelHeight: Math.max(MIN_PANEL_HEIGHT, Math.min(parsed.panelHeight, 1200)),
    }
  } catch {
    return null
  }
}

function persistState(state: TerminalPanelState): void {
  try {
    if (state.tabs.length === 0) {
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    const toPersist: PersistedTerminalState = {
      tabs: state.tabs.map((t) => ({
        binding: t.binding,
        color: t.color,
        label: t.label,
        paneTree: t.paneTree,
        fontSize: t.fontSize,
      })),
      activeTabIndex: state.activeTabId
        ? state.tabs.findIndex((t) => t.id === state.activeTabId)
        : null,
      isOpen: state.isOpen,
      panelHeight: state.panelHeight,
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist))
  } catch {
    // sessionStorage may be unavailable
  }
}

const DEFAULT_STATE: TerminalPanelState = {
  isOpen: false,
  panelHeight: DEFAULT_PANEL_HEIGHT,
  tabs: [],
  activeTabId: null,
}

// --- Provider ---

export function TerminalPanelProvider({ children }: { children: React.ReactNode }) {
  // Always start with DEFAULT_STATE so the server-rendered HTML matches the
  // client's first render. Persisted state is loaded in a post-mount effect —
  // reading sessionStorage during useState init would cause a hydration
  // mismatch (React error #418) and break interactivity for the whole tree.
  const [state, setState] = useState<TerminalPanelState>(DEFAULT_STATE)
  const [hasHydrated, setHasHydrated] = useState(false)

  // Hydrating from sessionStorage after mount is the canonical pattern for
  // avoiding SSR/CSR mismatch; hasHydrated flips once to gate the persistence
  // effect below.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const persisted = loadPersistedState()
    if (persisted) setState(persisted)
    setHasHydrated(true)
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hasHydrated) return
    persistState(state)
  }, [state, hasHydrated])

  const openTerminal = useCallback(
    (params: {
      hostId: string
      hostname: string
      username: string | null
      orgId: string
      directAccess: boolean
    }) => {
      const tabId = createId()
      const paneId = createId()
      const tab: TerminalTabInfo = {
        id: tabId,
        binding: { ...params },
        color: null,
        label: null,
        paneTree: { type: 'leaf', id: paneId },
        activePaneId: paneId,
        fontSize: null,
      }

      setState((prev) => ({
        ...prev,
        isOpen: true,
        tabs: [...prev.tabs, tab],
        activeTabId: tabId,
      }))
    },
    [],
  )

  const closeTab = useCallback((tabId: string) => {
    setState((prev) => {
      const remaining = prev.tabs.filter((t) => t.id !== tabId)
      let nextActive = prev.activeTabId
      if (prev.activeTabId === tabId) {
        const closedIdx = prev.tabs.findIndex((t) => t.id === tabId)
        nextActive =
          remaining[Math.max(0, closedIdx - 1)]?.id ?? remaining[0]?.id ?? null
      }
      return {
        ...prev,
        tabs: remaining,
        activeTabId: nextActive,
        isOpen: remaining.length > 0 ? prev.isOpen : false,
      }
    })
  }, [])

  const setActiveTab = useCallback((tabId: string) => {
    setState((prev) => ({ ...prev, activeTabId: tabId }))
  }, [])

  const togglePanel = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: !prev.isOpen }))
  }, [])

  const openPanel = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: true }))
  }, [])

  const closePanel = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }))
  }, [])

  const setPanelHeight = useCallback((height: number) => {
    const maxH = window.innerHeight * MAX_PANEL_HEIGHT_RATIO
    setState((prev) => ({
      ...prev,
      panelHeight: Math.max(MIN_PANEL_HEIGHT, Math.min(height, maxH)),
    }))
  }, [])

  const reorderTabs = useCallback((fromTabId: string, toTabId: string) => {
    if (fromTabId === toTabId) return
    setState((prev) => {
      const fromIdx = prev.tabs.findIndex((t) => t.id === fromTabId)
      const toIdx = prev.tabs.findIndex((t) => t.id === toTabId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = [...prev.tabs]
      const [moved] = next.splice(fromIdx, 1)
      if (!moved) return prev
      next.splice(toIdx, 0, moved)
      return { ...prev, tabs: next }
    })
  }, [])

  const setTabColor = useCallback((tabId: string, color: TerminalTabColor | null) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, color } : t)),
    }))
  }, [])

  const renameTab = useCallback((tabId: string, label: string) => {
    const trimmed = label.trim()
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === tabId ? { ...t, label: trimmed.length === 0 ? null : trimmed } : t,
      ),
    }))
  }, [])

  const splitPane = useCallback(
    (tabId: string, paneId: string, direction: 'row' | 'column') => {
      setState((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) => {
          if (t.id !== tabId) return t
          const newLeafId = createId()
          const splitId = createId()
          const nextTree = mapPaneTree(t.paneTree, paneId, (leaf) => ({
            type: 'split',
            id: splitId,
            direction,
            ratio: 0.5,
            children: [leaf, { type: 'leaf', id: newLeafId }],
          }))
          return { ...t, paneTree: nextTree, activePaneId: newLeafId }
        }),
      }))
    },
    [],
  )

  const closePane = useCallback((tabId: string, paneId: string) => {
    setState((prev) => {
      const target = prev.tabs.find((t) => t.id === tabId)
      if (!target) return prev
      const nextTree = removeLeafFromTree(target.paneTree, paneId)
      if (!nextTree) {
        // Closed the last pane — close the tab itself.
        const remaining = prev.tabs.filter((t) => t.id !== tabId)
        let nextActive = prev.activeTabId
        if (prev.activeTabId === tabId) {
          const closedIdx = prev.tabs.findIndex((t) => t.id === tabId)
          nextActive =
            remaining[Math.max(0, closedIdx - 1)]?.id ?? remaining[0]?.id ?? null
        }
        return {
          ...prev,
          tabs: remaining,
          activeTabId: nextActive,
          isOpen: remaining.length > 0 ? prev.isOpen : false,
        }
      }
      return {
        ...prev,
        tabs: prev.tabs.map((t) =>
          t.id === tabId
            ? { ...t, paneTree: nextTree, activePaneId: findFirstLeafId(nextTree) }
            : t,
        ),
      }
    })
  }, [])

  const setActivePane = useCallback((tabId: string, paneId: string) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t)),
    }))
  }, [])

  const setSplitRatio = useCallback((tabId: string, splitId: string, ratio: number) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === tabId ? { ...t, paneTree: setSplitRatioInTree(t.paneTree, splitId, ratio) } : t,
      ),
    }))
  }, [])

  const setTabFontSize = useCallback((tabId: string, fontSize: number | null) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, fontSize } : t)),
    }))
  }, [])

  return (
    <TerminalPanelContext.Provider
      value={{
        ...state,
        openTerminal,
        closeTab,
        setActiveTab,
        togglePanel,
        openPanel,
        closePanel,
        setPanelHeight,
        reorderTabs,
        setTabColor,
        renameTab,
        splitPane,
        closePane,
        setActivePane,
        setSplitRatio,
        setTabFontSize,
      }}
    >
      {children}
    </TerminalPanelContext.Provider>
  )
}

export function useTerminalPanel(): TerminalPanelContextValue {
  const ctx = useContext(TerminalPanelContext)
  if (!ctx) {
    throw new Error('useTerminalPanel must be used within a TerminalPanelProvider')
  }
  return ctx
}

// --- Shared color presets (used by UI) ---

export const TERMINAL_TAB_COLOR_PRESETS: ReadonlyArray<{
  value: TerminalTabColor
  label: string
  swatch: string
  accent: string
  tint: string
}> = [
  { value: 'slate', label: 'Slate', swatch: 'bg-slate-500', accent: 'bg-slate-500', tint: 'bg-slate-500/10' },
  { value: 'red', label: 'Red', swatch: 'bg-red-500', accent: 'bg-red-500', tint: 'bg-red-500/10' },
  { value: 'amber', label: 'Amber', swatch: 'bg-amber-500', accent: 'bg-amber-500', tint: 'bg-amber-500/10' },
  { value: 'emerald', label: 'Emerald', swatch: 'bg-emerald-500', accent: 'bg-emerald-500', tint: 'bg-emerald-500/10' },
  { value: 'sky', label: 'Sky', swatch: 'bg-sky-500', accent: 'bg-sky-500', tint: 'bg-sky-500/10' },
  { value: 'violet', label: 'Violet', swatch: 'bg-violet-500', accent: 'bg-violet-500', tint: 'bg-violet-500/10' },
  { value: 'pink', label: 'Pink', swatch: 'bg-pink-500', accent: 'bg-pink-500', tint: 'bg-pink-500/10' },
]

export function getTabColorPreset(color: TerminalTabColor | null | undefined) {
  if (!color) return null
  return TERMINAL_TAB_COLOR_PRESETS.find((c) => c.value === color) ?? null
}
