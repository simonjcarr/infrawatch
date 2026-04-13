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
  HeartPulse,
  ChevronRight,
  Layers,
  Terminal,
} from 'lucide-react'
import { Collapsible as CollapsiblePrimitive } from 'radix-ui'
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { TerminalPanelTrigger } from '@/components/terminal'
import pkg from '../../package.json'

const WEB_VERSION = `v${pkg.version}`

interface NavChild {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
}

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  children?: NavChild[]
}

const primaryNav: NavItem[] = [
  { title: 'Overview', href: '/dashboard', icon: BarChart3 },
  {
    title: 'Hosts',
    href: '/hosts',
    icon: Server,
    children: [
      { title: 'All Hosts', href: '/hosts', icon: Server },
      { title: 'Groups', href: '/hosts/groups', icon: Layers },
    ],
  },
  { title: 'Checks & Alerts', href: '/alerts', icon: Bell },
  { title: 'Notifications', href: '/notifications', icon: BellPlus },
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
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
    children: [
      { title: 'Organisation', href: '/settings', icon: Settings },
      { title: 'Agent Enrolment', href: '/settings/agents', icon: Server },
      { title: 'Alert Defaults', href: '/settings/alerts', icon: BellPlus },
      { title: 'LDAP / Directory', href: '/settings/ldap', icon: Key },
      { title: 'System Health', href: '/settings/system', icon: HeartPulse },
    ],
  },
]

function CollapsibleNavItem({ item }: { item: NavItem & { children: NavChild[] } }) {
  const pathname = usePathname()

  // Auto-open if any child (or the parent itself) is active
  const isAnyChildActive = item.children.some((child) =>
    child.href === '/hosts' || child.href === '/settings'
      ? pathname === child.href || (pathname.startsWith(child.href + '/') && child.href !== '/hosts')
      : pathname.startsWith(child.href)
  )
  const isParentActive = pathname.startsWith(item.href) && item.href !== '/dashboard'

  // For /hosts specifically: active when on /hosts exactly or /hosts/groups/* but NOT /hosts/[id]
  // The parent highlight just needs to know if we're somewhere in the subtree
  const defaultOpen = isParentActive || isAnyChildActive

  return (
    <CollapsiblePrimitive.Root defaultOpen={defaultOpen}>
      <SidebarMenuItem>
        <CollapsiblePrimitive.Trigger asChild>
          <SidebarMenuButton
            className={cn(
              'w-full',
              defaultOpen && 'text-sidebar-foreground'
            )}
          >
            <item.icon
              className={cn(
                'size-4',
                defaultOpen ? 'text-sidebar-primary' : 'text-sidebar-foreground/70'
              )}
            />
            <span>{item.title}</span>
            <ChevronRight
              className={cn(
                'ml-auto size-3 text-sidebar-foreground/50 transition-transform duration-200',
                defaultOpen && 'rotate-90'
              )}
            />
          </SidebarMenuButton>
        </CollapsiblePrimitive.Trigger>
        <CollapsiblePrimitive.Content>
          <SidebarMenuSub>
            {item.children.map((child) => {
              // Exact match for leaf pages like /hosts and /settings to avoid
              // /hosts being active when viewing /hosts/groups/[id]
              const isActive =
                child.href === '/hosts' || child.href === '/settings'
                  ? pathname === child.href
                  : pathname.startsWith(child.href)
              return (
                <SidebarMenuSubItem key={child.href}>
                  <SidebarMenuSubButton asChild isActive={isActive}>
                    <Link href={child.href}>
                      <child.icon
                        className={cn(
                          'size-3.5',
                          isActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/60'
                        )}
                      />
                      <span>{child.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })}
          </SidebarMenuSub>
        </CollapsiblePrimitive.Content>
      </SidebarMenuItem>
    </CollapsiblePrimitive.Root>
  )
}

function NavGroupItems({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  return (
    <>
      {items.map((item) => {
        if (item.children && item.children.length > 0) {
          return <CollapsibleNavItem key={item.href} item={item as NavItem & { children: NavChild[] }} />
        }

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
    </>
  )
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <NavGroupItems items={items} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar({ orgId }: { orgId: string }) {
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
        <SidebarGroup>
          <SidebarGroupLabel>Tooling</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavGroupItems items={toolingNav} />
              <SidebarMenuItem>
                <TerminalPanelTrigger orgId={orgId} />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
