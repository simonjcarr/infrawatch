'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Server,
  ShieldCheck,
  Bell,
  BellPlus,
  Key,
  Package,
  BookOpen,
  Settings,
  BarChart3,
  Activity,
  Users,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import pkg from '../../package.json'

const WEB_VERSION = `v${pkg.version}`

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
}

const primaryNav: NavItem[] = [
  { title: 'Overview', href: '/dashboard', icon: BarChart3 },
  { title: 'Hosts', href: '/hosts', icon: Server },
  { title: 'Checks & Alerts', href: '/alerts', icon: Bell },
  { title: 'Certificates', href: '/certificates', icon: ShieldCheck },
  { title: 'Service Accounts', href: '/service-accounts', icon: Key },
]

const toolingNav: NavItem[] = [
  { title: 'Air-gap Bundlers', href: '/bundlers', icon: Package },
  { title: 'Runbooks', href: '/runbooks', icon: BookOpen },
  { title: 'Scheduled Tasks', href: '/tasks', icon: Activity },
]

const adminNav: NavItem[] = [
  { title: 'Team', href: '/team', icon: Users },
  { title: 'Settings', href: '/settings', icon: Settings },
  { title: 'Agent Enrolment', href: '/settings/agents', icon: Server },
  { title: 'Global Alert Defaults', href: '/settings/alerts', icon: BellPlus },
]

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = usePathname()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href)
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={isActive}>
                  <Link href={item.href}>
                    <item.icon className={cn('size-4', isActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/70')} />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
            IW
          </div>
          <span className="font-semibold text-sm text-sidebar-foreground">Infrawatch</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Monitoring" items={primaryNav} />
        <NavGroup label="Tooling" items={toolingNav} />
        <NavGroup label="Administration" items={adminNav} />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <p className="text-xs text-muted-foreground px-2 py-1">
          Community Edition <span className="font-mono">{WEB_VERSION}</span>
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
