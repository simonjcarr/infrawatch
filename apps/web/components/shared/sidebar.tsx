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
  FileBarChart,
  Network,
  FolderSearch,
  ScanSearch,
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
import { hasFeature, type Feature, type LicenceTier } from '@/lib/features'
import pkg from '../../package.json'

const WEB_VERSION = `v${pkg.version}`

interface NavChild {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  feature?: Feature
}

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  feature?: Feature
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
      { title: 'Networks', href: '/hosts/networks', icon: Network },
    ],
  },
  { title: 'Checks & Alerts', href: '/alerts', icon: Bell },
  { title: 'Notifications', href: '/notifications', icon: BellPlus },
  { title: 'Certificates', href: '/certificates', icon: ShieldCheck, feature: 'certExpiryTracker' },
  { title: 'Service Accounts', href: '/service-accounts', icon: Key, feature: 'serviceAccountTracker' },
]

const reportingNav: NavItem[] = [
  {
    title: 'Reports',
    href: '/reports',
    icon: FileBarChart,
    feature: 'reportsExport',
    children: [
      { title: 'Installed Software', href: '/reports/software', icon: Package, feature: 'reportsExport' },
    ],
  },
]

const toolingNav: NavItem[] = [
  { title: 'SSL Certificate Checker', href: '/certificate-checker', icon: ScanSearch },
  { title: 'Directory User Lookup', href: '/directory-lookup', icon: FolderSearch },
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

function ProBadge() {
  return (
    <span className="ml-auto rounded-sm border border-sidebar-border/70 px-1 py-0 text-[9px] font-semibold uppercase tracking-wide text-sidebar-foreground/60">
      Pro
    </span>
  )
}

function CollapsibleNavItem({
  item,
  tier,
}: {
  item: NavItem & { children: NavChild[] }
  tier: LicenceTier
}) {
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
  const parentLocked = item.feature ? !hasFeature(tier, item.feature) : false

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
            {parentLocked ? <ProBadge /> : null}
            <ChevronRight
              className={cn(
                'size-3 text-sidebar-foreground/50 transition-transform duration-200',
                parentLocked ? 'ml-1' : 'ml-auto',
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
              const childLocked = child.feature ? !hasFeature(tier, child.feature) : false
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
                      {childLocked ? <ProBadge /> : null}
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

function NavGroupItems({ items, tier }: { items: NavItem[]; tier: LicenceTier }) {
  const pathname = usePathname()
  return (
    <>
      {items.map((item) => {
        if (item.children && item.children.length > 0) {
          return (
            <CollapsibleNavItem
              key={item.href}
              item={item as NavItem & { children: NavChild[] }}
              tier={tier}
            />
          )
        }

        const isActive =
          item.href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(item.href)
        const locked = item.feature ? !hasFeature(tier, item.feature) : false
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild isActive={isActive}>
              <Link href={item.href}>
                <item.icon className={cn('size-4', isActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/70')} />
                <span>{item.title}</span>
                {locked ? <ProBadge /> : null}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </>
  )
}

function NavGroup({
  label,
  items,
  tier,
}: {
  label: string
  items: NavItem[]
  tier: LicenceTier
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <NavGroupItems items={items} tier={tier} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

const TIER_LABEL: Record<LicenceTier, string> = {
  community: 'Community Edition',
  pro: 'Pro Edition',
  enterprise: 'Enterprise Edition',
}

export function AppSidebar({ orgId, tier }: { orgId: string; tier: LicenceTier }) {
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
        <NavGroup label="Monitoring" items={primaryNav} tier={tier} />
        <NavGroup label="Reporting" items={reportingNav} tier={tier} />
        <SidebarGroup>
          <SidebarGroupLabel>Tooling</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavGroupItems items={toolingNav} tier={tier} />
              <SidebarMenuItem>
                <TerminalPanelTrigger orgId={orgId} />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <NavGroup label="Administration" items={adminNav} tier={tier} />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <p className="text-xs text-muted-foreground px-2 py-1">
          {TIER_LABEL[tier]} <span className="font-mono">{WEB_VERSION}</span>
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
