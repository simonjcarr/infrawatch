'use client'

import { useSyncExternalStore } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCommandPalette } from './command-palette'

function subscribePlatform(): () => void {
  return () => {}
}

function getIsMac(): boolean {
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform)
}

function getServerIsMac(): null {
  return null
}

export function CommandPaletteTrigger() {
  const { open } = useCommandPalette()
  const isMac = useSyncExternalStore(subscribePlatform, getIsMac, getServerIsMac)

  const shortcutLabel = isMac === null ? '' : isMac ? '⌘K' : 'Ctrl K'

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={open}
      className="hidden h-8 gap-2 px-2 text-muted-foreground sm:inline-flex"
      aria-label="Open command palette"
    >
      <Search className="size-4" />
      <span className="text-xs">Search</span>
      {shortcutLabel ? (
        <kbd className="ml-1 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {shortcutLabel}
        </kbd>
      ) : null}
    </Button>
  )
}
