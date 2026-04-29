'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { useNavigationItems, useHostItems } from './providers'
import type { CommandPaletteGroup, CommandPaletteItem } from './types'

const RECENTS_STORAGE_KEY = 'ct-ops.command-palette.recents'
const MAX_RECENTS = 5

interface CommandPaletteContextValue {
  open: () => void
  close: () => void
  toggle: () => void
  isOpen: boolean
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null)

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext)
  if (!ctx) {
    throw new Error('useCommandPalette must be used inside <CommandPaletteProvider>')
  }
  return ctx
}

function readRecents(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

function writeRecents(ids: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_RECENTS)))
  } catch {
    // ignore quota or serialisation errors
  }
}

interface CommandPaletteProviderProps {
  orgId: string
  userRole: string
  children: React.ReactNode
}

export function CommandPaletteProvider({ orgId, userRole, children }: CommandPaletteProviderProps) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isPaletteCombo =
        event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
      if (isPaletteCombo) {
        event.preventDefault()
        setIsOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const value = useMemo<CommandPaletteContextValue>(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle],
  )

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPaletteDialog orgId={orgId} userRole={userRole} isOpen={isOpen} onOpenChange={setIsOpen} />
    </CommandPaletteContext.Provider>
  )
}

interface CommandPaletteDialogProps {
  orgId: string
  userRole: string
  isOpen: boolean
  onOpenChange: (next: boolean) => void
}

function CommandPaletteDialog({ orgId, userRole, isOpen, onOpenChange }: CommandPaletteDialogProps) {
  const router = useRouter()
  const navItems = useNavigationItems(userRole)
  const hostItems = useHostItems(orgId, isOpen)

  const allItems = useMemo(() => [...navItems, ...hostItems], [navItems, hostItems])

  const groups = useMemo<CommandPaletteGroup[]>(() => {
    const groupMap = new Map<string, CommandPaletteItem[]>()
    for (const item of allItems) {
      const list = groupMap.get(item.group) ?? []
      list.push(item)
      groupMap.set(item.group, list)
    }
    return Array.from(groupMap.entries()).map(([heading, items]) => ({ heading, items }))
  }, [allItems])

  const recentItems = useMemo<CommandPaletteItem[]>(() => {
    if (!isOpen) return []
    const ids = readRecents()
    if (ids.length === 0) return []
    const byId = new Map(allItems.map((item) => [item.id, item]))
    return ids
      .map((id) => byId.get(id))
      .filter((item): item is CommandPaletteItem => item !== undefined)
  }, [isOpen, allItems])

  const handleSelect = useCallback(
    (item: CommandPaletteItem) => {
      const current = readRecents()
      const next = [item.id, ...current.filter((id) => id !== item.id)].slice(0, MAX_RECENTS)
      writeRecents(next)
      onOpenChange(false)
      if (item.onSelect) {
        item.onSelect()
      } else if (item.href) {
        router.push(item.href)
      }
    },
    [onOpenChange, router],
  )

  return (
    <CommandDialog open={isOpen} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search hosts, navigate, run commands…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {recentItems.length > 0 && (
          <>
            <CommandGroup heading="Recent">
              {recentItems.map((item) => (
                <PaletteRow key={`recent-${item.id}`} item={item} onSelect={handleSelect} />
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.items.map((item) => (
              <PaletteRow key={item.id} item={item} onSelect={handleSelect} />
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}

interface PaletteRowProps {
  item: CommandPaletteItem
  onSelect: (item: CommandPaletteItem) => void
}

function PaletteRow({ item, onSelect }: PaletteRowProps) {
  const Icon = item.icon
  const searchValue = [item.label, item.description, ...(item.keywords ?? [])]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .join(' ')
  return (
    <CommandItem value={searchValue} onSelect={() => onSelect(item)}>
      {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
      <div className="flex flex-col">
        <span className="text-sm text-foreground">{item.label}</span>
        {item.description ? (
          <span className="text-xs text-muted-foreground">{item.description}</span>
        ) : null}
      </div>
    </CommandItem>
  )
}
