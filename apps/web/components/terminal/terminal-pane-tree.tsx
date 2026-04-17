'use client'

import { useRef, useCallback } from 'react'
import { SplitSquareHorizontal, SplitSquareVertical, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  TerminalPaneNode,
  TerminalSessionBinding,
} from './terminal-panel-context'
import { TerminalSession, type TerminalSessionStatus } from './terminal-session'

interface PaneTreeProps {
  tabId: string
  node: TerminalPaneNode
  binding: TerminalSessionBinding
  isVisible: boolean
  activePaneId: string
  fontSize: number
  onSessionStatusChange: (paneId: string, status: TerminalSessionStatus) => void
  onFocusPane: (paneId: string) => void
  onSplitPane: (paneId: string, direction: 'row' | 'column') => void
  onClosePane: (paneId: string) => void
  onSplitRatioChange: (splitId: string, ratio: number) => void
}

export function TerminalPaneTree(props: PaneTreeProps) {
  return <PaneNode {...props} node={props.node} />
}

function PaneNode(props: PaneTreeProps) {
  const { node } = props
  if (node.type === 'leaf') {
    return <PaneLeaf {...props} node={node} />
  }
  return <PaneSplit {...props} node={node} />
}

function PaneLeaf({
  node,
  binding,
  isVisible,
  activePaneId,
  fontSize,
  onSessionStatusChange,
  onFocusPane,
  onSplitPane,
  onClosePane,
}: PaneTreeProps & { node: { type: 'leaf'; id: string } }) {
  const isActive = node.id === activePaneId
  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden',
        isActive && 'ring-1 ring-inset ring-primary/40',
      )}
    >
      <TerminalSession
        paneId={node.id}
        binding={binding}
        isVisible={isVisible}
        isFocused={isActive}
        fontSize={fontSize}
        onStatusChange={onSessionStatusChange}
        onFocus={() => onFocusPane(node.id)}
      />
      {/* Per-pane action toolbar (top-right) */}
      <div
        className={cn(
          'absolute top-1 right-1 z-10 flex items-center gap-0.5 rounded-md border border-border bg-background/80 backdrop-blur-sm px-0.5 py-0.5 shadow-sm',
          'opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity',
          isActive && 'opacity-70',
        )}
      >
        <button
          title="Split right (vertical)"
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onSplitPane(node.id, 'row')
          }}
        >
          <SplitSquareVertical className="size-3.5" />
        </button>
        <button
          title="Split down (horizontal)"
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onSplitPane(node.id, 'column')
          }}
        >
          <SplitSquareHorizontal className="size-3.5" />
        </button>
        <button
          title="Close pane"
          className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation()
            onClosePane(node.id)
          }}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function PaneSplit({
  node,
  ...rest
}: PaneTreeProps & {
  node: Extract<TerminalPaneNode, { type: 'split' }>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isRow = node.direction === 'row'

  const handleSplitterDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      const total = isRow ? rect.width : rect.height
      const origin = isRow ? rect.left : rect.top

      const handleMove = (me: MouseEvent) => {
        const pos = isRow ? me.clientX : me.clientY
        const ratio = (pos - origin) / total
        rest.onSplitRatioChange(node.id, ratio)
      }

      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove)
        document.removeEventListener('mouseup', handleUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = isRow ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMove)
      document.addEventListener('mouseup', handleUp)
    },
    [isRow, node.id, rest],
  )

  const primaryPct = `${(node.ratio * 100).toFixed(2)}%`
  const secondaryPct = `${((1 - node.ratio) * 100).toFixed(2)}%`

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full w-full', isRow ? 'flex-row' : 'flex-col')}
    >
      <div
        className="overflow-hidden"
        style={{ [isRow ? 'width' : 'height']: primaryPct }}
      >
        <PaneNode {...rest} node={node.children[0]} />
      </div>
      <div
        onMouseDown={handleSplitterDown}
        className={cn(
          'shrink-0 bg-border hover:bg-primary/40 active:bg-primary/60 transition-colors z-10',
          isRow ? 'w-[2px] cursor-col-resize' : 'h-[2px] cursor-row-resize',
        )}
      />
      <div
        className="overflow-hidden"
        style={{ [isRow ? 'width' : 'height']: secondaryPct }}
      >
        <PaneNode {...rest} node={node.children[1]} />
      </div>
    </div>
  )
}
