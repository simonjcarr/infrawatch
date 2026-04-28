'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  X,
  Plus,
  ChevronDown,
  ChevronUp,
  Terminal,
  Circle,
  Check,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Pencil,
  Palette,
  Settings2,
  Type,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  useTerminalPanel,
  TERMINAL_TAB_COLOR_PRESETS,
  getTabColorPreset,
  type TerminalTabInfo,
  type TerminalTabColor,
} from './terminal-panel-context'
import {
  useTerminalPreferences,
  FONT_SIZE_PRESETS,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  DEFAULT_FONT_SIZE,
} from './terminal-preferences'
import { TerminalPaneTree } from './terminal-pane-tree'
import { HostSelectorDialog } from './host-selector-dialog'
import type { TerminalSessionStatus } from './terminal-session'

interface Props {
  orgId: string
}

export function TerminalPanel({ orgId }: Props) {
  const {
    isOpen,
    panelHeight,
    tabs,
    activeTabId,
    closeTab,
    setActiveTab,
    togglePanel,
    setPanelHeight,
    reorderTabs,
    setTabColor,
    renameTab,
    splitPane,
    closePane,
    setActivePane,
    setSplitRatio,
    setTabFontSize,
    clearTabPassword,
  } = useTerminalPanel()
  const { preferences, setFontSize: setGlobalFontSize } = useTerminalPreferences()

  const [hostSelectorOpen, setHostSelectorOpen] = useState(false)
  // Status is now tracked per-pane, keyed by paneId
  const [paneStatuses, setPaneStatuses] = useState<Record<string, TerminalSessionStatus>>({})
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  const handleSessionStatusChange = useCallback(
    (paneId: string, status: TerminalSessionStatus) => {
      setPaneStatuses((prev) => ({ ...prev, [paneId]: status }))
    },
    [],
  )

  // Resize drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isResizing.current = true
      startY.current = e.clientY
      startHeight.current = panelHeight

      const handleMouseMove = (me: MouseEvent) => {
        if (!isResizing.current) return
        const delta = startY.current - me.clientY
        setPanelHeight(startHeight.current + delta)
      }

      const handleMouseUp = () => {
        isResizing.current = false
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [panelHeight, setPanelHeight],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id) return
      reorderTabs(String(active.id), String(over.id))
    },
    [reorderTabs],
  )

  if (tabs.length === 0) {
    return (
      <HostSelectorDialog
        open={hostSelectorOpen}
        onOpenChange={setHostSelectorOpen}
        orgId={orgId}
      />
    )
  }

  // Aggregate status across all panes in a tab (worst state wins for the dot).
  const tabAggregateStatus = (tab: TerminalTabInfo): TerminalSessionStatus | undefined => {
    const paneIds = collectLeafIds(tab.paneTree)
    let result: TerminalSessionStatus | undefined
    const priority: Record<TerminalSessionStatus, number> = {
      error: 4,
      connecting: 3,
      closed: 2,
      connected: 1,
    }
    for (const id of paneIds) {
      const s = paneStatuses[id]
      if (!s) continue
      if (!result || priority[s] > priority[result]) result = s
    }
    return result
  }

  const statusColor = (tab: TerminalTabInfo) => {
    const s = tabAggregateStatus(tab)
    if (s === 'connected') return 'text-green-500'
    if (s === 'connecting') return 'text-amber-500 animate-pulse'
    if (s === 'error') return 'text-red-500'
    return 'text-zinc-500'
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  return (
    <>
      <div
        ref={panelRef}
        className="border-t border-border bg-background flex flex-col shrink-0"
        style={{ height: isOpen ? panelHeight : 'auto' }}
      >
        {/* Resize handle */}
        {isOpen && (
          <div
            className="h-1 cursor-ns-resize hover:bg-primary/20 active:bg-primary/30 transition-colors shrink-0"
            onMouseDown={handleMouseDown}
          />
        )}

        {/* Tab bar */}
        <div className="flex items-center border-b border-border bg-muted/30 shrink-0">
          <div className="flex-1 flex items-center overflow-x-auto min-w-0">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={tabs.map((t) => t.id)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex items-center min-w-0">
                  {tabs.map((tab) => (
                    <SortableTab
                      key={tab.id}
                      tab={tab}
                      isActive={tab.id === activeTabId}
                      statusColorClass={statusColor(tab)}
                      isRenaming={renamingTabId === tab.id}
                      onActivate={() => {
                        setActiveTab(tab.id)
                        if (!isOpen) togglePanel()
                      }}
                      onClose={() => closeTab(tab.id)}
                      onStartRename={() => setRenamingTabId(tab.id)}
                      onFinishRename={(label) => {
                        renameTab(tab.id, label)
                        setRenamingTabId(null)
                      }}
                      onCancelRename={() => setRenamingTabId(null)}
                      onSetColor={(c) => setTabColor(tab.id, c)}
                      onSplitActive={(dir) => {
                        const active = tabs.find((t) => t.id === tab.id)
                        if (active) splitPane(tab.id, active.activePaneId, dir)
                      }}
                      onSetFontSize={(size) => setTabFontSize(tab.id, size)}
                      globalFontSize={preferences.fontSize}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          <div className="flex items-center gap-0.5 px-2 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setHostSelectorOpen(true)}
              title="Open new terminal"
            >
              <Plus className="size-3.5" />
            </Button>
            <TerminalSettingsPopover
              fontSize={preferences.fontSize}
              onFontSizeChange={setGlobalFontSize}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={togglePanel}
              title={isOpen ? 'Minimize panel' : 'Expand panel'}
            >
              {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
            </Button>
          </div>
        </div>

        {/* Terminal content */}
        {isOpen && activeTab && (
          <div className="flex-1 min-h-0 relative">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{ display: tab.id === activeTab.id ? 'block' : 'none' }}
              >
                <TerminalPaneTree
                  tabId={tab.id}
                  node={tab.paneTree}
                  binding={tab.binding}
                  isVisible={tab.id === activeTab.id}
                  activePaneId={tab.activePaneId}
                  fontSize={tab.fontSize ?? preferences.fontSize}
                  onSessionStatusChange={handleSessionStatusChange}
                  onFocusPane={(paneId) => setActivePane(tab.id, paneId)}
                  onSessionEnded={() => clearTabPassword(tab.id)}
                  onSplitPane={(paneId, dir) => splitPane(tab.id, paneId, dir)}
                  onClosePane={(paneId) => closePane(tab.id, paneId)}
                  onSplitRatioChange={(splitId, ratio) =>
                    setSplitRatio(tab.id, splitId, ratio)
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <HostSelectorDialog
        open={hostSelectorOpen}
        onOpenChange={setHostSelectorOpen}
        orgId={orgId}
      />
    </>
  )
}

/**
 * Collect all leaf paneIds from a pane tree so we can aggregate status.
 */
function collectLeafIds(node: TerminalTabInfo['paneTree']): string[] {
  if (node.type === 'leaf') return [node.id]
  return [...collectLeafIds(node.children[0]), ...collectLeafIds(node.children[1])]
}

interface SortableTabProps {
  tab: TerminalTabInfo
  isActive: boolean
  statusColorClass: string
  isRenaming: boolean
  globalFontSize: number
  onActivate: () => void
  onClose: () => void
  onStartRename: () => void
  onFinishRename: (label: string) => void
  onCancelRename: () => void
  onSetColor: (color: TerminalTabColor | null) => void
  onSplitActive: (direction: 'row' | 'column') => void
  onSetFontSize: (size: number | null) => void
}

function SortableTab({
  tab,
  isActive,
  statusColorClass,
  isRenaming,
  globalFontSize,
  onActivate,
  onClose,
  onStartRename,
  onFinishRename,
  onCancelRename,
  onSetColor,
  onSplitActive,
  onSetFontSize,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const preset = getTabColorPreset(tab.color)
  const displayLabel = tab.label ?? tab.binding.hostname

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            'group relative flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-border cursor-pointer select-none shrink-0 max-w-48',
            isActive
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            preset && isActive && preset.tint,
          )}
          onClick={onActivate}
          onDoubleClick={(e) => {
            e.stopPropagation()
            onStartRename()
          }}
          {...attributes}
          {...listeners}
        >
          {/* Left colour accent bar */}
          {preset && (
            <span
              aria-hidden
              className={cn('absolute left-0 top-0 bottom-0 w-0.5', preset.accent)}
            />
          )}
          <Circle className={cn('size-2 shrink-0 fill-current', statusColorClass)} />
          {isRenaming ? (
            <RenameInput
              initial={tab.label ?? ''}
              placeholder={tab.binding.hostname}
              onCommit={onFinishRename}
              onCancel={onCancelRename}
            />
          ) : (
            <span className="truncate">
              {displayLabel}
              {tab.binding.username && !tab.label && (
                <span className="text-muted-foreground ml-1">
                  ({tab.binding.username})
                </span>
              )}
            </span>
          )}
          <button
            className="ml-1 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onStartRename}>
          <Pencil className="size-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Palette className="size-3.5" />
            Tab colour
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-40">
            <ContextMenuItem onClick={() => onSetColor(null)}>
              <span className="size-3 rounded-full border border-border" />
              No colour
              {!tab.color && <Check className="ml-auto size-3.5" />}
            </ContextMenuItem>
            <ContextMenuSeparator />
            {TERMINAL_TAB_COLOR_PRESETS.map((c) => (
              <ContextMenuItem key={c.value} onClick={() => onSetColor(c.value)}>
                <span className={cn('size-3 rounded-full', c.swatch)} />
                {c.label}
                {tab.color === c.value && <Check className="ml-auto size-3.5" />}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Type className="size-3.5" />
            Text size
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuItem onClick={() => onSetFontSize(null)}>
              <span className="text-muted-foreground w-3 text-center text-[10px]">
                ·
              </span>
              Use default ({globalFontSize}px)
              {tab.fontSize === null && <Check className="ml-auto size-3.5" />}
            </ContextMenuItem>
            <ContextMenuSeparator />
            {FONT_SIZE_PRESETS.map((p) => (
              <ContextMenuItem key={p.value} onClick={() => onSetFontSize(p.value)}>
                <span className="text-muted-foreground w-3 text-center text-[10px]">
                  {p.value}
                </span>
                {p.label}
                {tab.fontSize === p.value && <Check className="ml-auto size-3.5" />}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onSplitActive('row')}>
          <SplitSquareVertical className="size-3.5" />
          Split right
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onSplitActive('column')}>
          <SplitSquareHorizontal className="size-3.5" />
          Split down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={onClose}
          variant="destructive"
        >
          <X className="size-3.5" />
          Close tab
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function RenameInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string
  placeholder: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <input
      ref={inputRef}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
        e.stopPropagation()
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onCommit(value)}
      className="h-5 px-1 w-28 rounded-sm border border-border bg-background text-foreground text-xs outline-none focus:ring-1 focus:ring-primary"
    />
  )
}

/**
 * Global terminal settings. Currently exposes only the default font size, but
 * intentionally structured as a popover so more preferences can be added here
 * (theme, cursor style, scrollback, etc.) without redesigning the toolbar.
 */
function TerminalSettingsPopover({
  fontSize,
  onFontSizeChange,
}: {
  fontSize: number
  onFontSizeChange: (size: number) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="Terminal settings"
        >
          <Settings2 className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3 space-y-3">
        <div className="space-y-1">
          <div className="text-xs font-medium text-foreground">Terminal settings</div>
          <div className="text-xs text-muted-foreground">
            Applies to every terminal tab. Individual tabs can override these
            defaults from their right-click menu.
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center justify-between">
            <span>Default text size</span>
            <span className="tabular-nums text-foreground">{fontSize}px</span>
          </label>
          <input
            type="range"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            value={fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex flex-wrap gap-1 pt-1">
            {FONT_SIZE_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => onFontSizeChange(p.value)}
                className={cn(
                  'px-2 py-0.5 text-[11px] rounded border border-border transition-colors',
                  fontSize === p.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                {p.value}
              </button>
            ))}
            <button
              onClick={() => onFontSizeChange(DEFAULT_FONT_SIZE)}
              className="px-2 py-0.5 text-[11px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ml-auto"
              title="Reset to factory default"
            >
              Reset
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Button that can be placed anywhere (e.g. sidebar) to open the terminal host selector.
 * Must be rendered inside a TerminalPanelProvider.
 */
export function TerminalPanelTrigger({ orgId }: { orgId: string }) {
  const { tabs, openPanel } = useTerminalPanel()
  const [selectorOpen, setSelectorOpen] = useState(false)

  const handleClick = () => {
    if (tabs.length > 0) {
      openPanel()
    } else {
      setSelectorOpen(true)
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors text-sidebar-foreground/70"
      >
        <Terminal className="size-4" />
        <span>Terminal</span>
      </button>
      <HostSelectorDialog open={selectorOpen} onOpenChange={setSelectorOpen} orgId={orgId} />
    </>
  )
}
