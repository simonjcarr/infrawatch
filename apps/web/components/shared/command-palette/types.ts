import type { LucideIcon } from 'lucide-react'

export interface CommandPaletteItem {
  id: string
  label: string
  description?: string
  keywords?: string[]
  icon?: LucideIcon
  group: string
  href?: string
  onSelect?: () => void
}

export interface CommandPaletteGroup {
  heading: string
  items: CommandPaletteItem[]
}
