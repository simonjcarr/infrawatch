'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface AdminTab {
  title: string
  href: string
}

interface AdminTabsProps {
  tabs: AdminTab[]
}

export function AdminTabs({ tabs }: AdminTabsProps) {
  const pathname = usePathname()

  return (
    <div className="overflow-x-auto">
      <nav className="inline-flex min-w-full gap-1 border-b border-border" aria-label="Administration section tabs">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.title}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
