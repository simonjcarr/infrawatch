'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  BarChart3,
  Bell,
  BellPlus,
  BookOpen,
  FileBarChart,
  FolderSearch,
  HeartPulse,
  Key,
  Layers,
  Lock,
  Network,
  Package,
  ScanSearch,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { listHosts } from '@/lib/actions/agents'
import type { CommandPaletteItem } from './types'

const NAV_ITEMS: ReadonlyArray<Omit<CommandPaletteItem, 'group'>> = [
  { id: 'nav-dashboard', label: 'Overview', icon: BarChart3, href: '/dashboard', keywords: ['home', 'start'] },
  { id: 'nav-hosts', label: 'Hosts', icon: Server, href: '/hosts', keywords: ['servers', 'machines'] },
  { id: 'nav-host-groups', label: 'Host Groups', icon: Layers, href: '/hosts/groups' },
  { id: 'nav-networks', label: 'Networks', icon: Network, href: '/hosts/networks' },
  { id: 'nav-alerts', label: 'Checks & Alerts', icon: Bell, href: '/alerts', keywords: ['monitors', 'checks'] },
  { id: 'nav-notifications', label: 'Notifications', icon: BellPlus, href: '/notifications' },
  { id: 'nav-certificates', label: 'Certificates', icon: ShieldCheck, href: '/certificates', keywords: ['ssl', 'tls', 'certs'] },
  { id: 'nav-service-accounts', label: 'Service Accounts', icon: Key, href: '/service-accounts' },
  { id: 'nav-reports', label: 'Reports', icon: FileBarChart, href: '/reports' },
  { id: 'nav-reports-software', label: 'Installed Software Report', icon: Package, href: '/reports/software' },
  { id: 'nav-reports-patch-status', label: 'Patch Status Report', icon: ShieldCheck, href: '/reports/patch-status' },
  { id: 'nav-reports-vulnerabilities', label: 'Vulnerability Report', icon: ShieldAlert, href: '/reports/vulnerabilities' },
  { id: 'nav-cert-checker', label: 'SSL Certificate Checker', icon: ScanSearch, href: '/certificate-checker' },
  { id: 'nav-dir-lookup', label: 'Directory User Lookup', icon: FolderSearch, href: '/directory-lookup' },
  { id: 'nav-bundlers', label: 'Air-gap Bundlers', icon: Package, href: '/bundlers' },
  { id: 'nav-runbooks', label: 'Runbooks', icon: BookOpen, href: '/runbooks' },
  { id: 'nav-tasks', label: 'Scheduled Tasks', icon: Activity, href: '/tasks' },
  { id: 'nav-people', label: 'People', icon: Users, href: '/team', keywords: ['team', 'members', 'users'] },
  { id: 'nav-organisation', label: 'Organisation', icon: Settings, href: '/settings', keywords: ['settings', 'profile'] },
  { id: 'nav-agents-admin', label: 'Agents', icon: Server, href: '/settings/agents', keywords: ['enrolment', 'defaults'] },
  { id: 'nav-monitoring-admin', label: 'Monitoring Settings', icon: BellPlus, href: '/settings/monitoring', keywords: ['alerts', 'retention'] },
  { id: 'nav-integrations-admin', label: 'Integrations', icon: Key, href: '/settings/integrations', keywords: ['ldap', 'smtp', 'directory'] },
  { id: 'nav-security-admin', label: 'Security', icon: Lock, href: '/settings/security', keywords: ['mtls', 'terminal'] },
  { id: 'nav-system-health', label: 'System', icon: HeartPulse, href: '/settings/system', keywords: ['health'] },
]

export function useNavigationItems(): CommandPaletteItem[] {
  return useMemo(
    () => NAV_ITEMS.map((item) => ({ ...item, group: 'Navigation' })),
    [],
  )
}

export function useHostItems(orgId: string, enabled: boolean): CommandPaletteItem[] {
  const { data } = useQuery({
    queryKey: ['command-palette', 'hosts', orgId],
    queryFn: () => listHosts(orgId),
    enabled,
    staleTime: 30_000,
  })

  return useMemo(() => {
    if (!data) return []
    return data.map((host) => {
      const ips = Array.isArray(host.ipAddresses) ? host.ipAddresses : []
      const displayName = host.displayName ?? host.hostname
      const description = [host.hostname !== displayName ? host.hostname : null, host.os, ips[0]]
        .filter(Boolean)
        .join(' · ')
      return {
        id: `host-${host.id}`,
        label: displayName,
        description: description || undefined,
        icon: Server,
        group: 'Hosts',
        keywords: [host.hostname, ...ips],
        href: `/hosts/${host.id}`,
      }
    })
  }, [data])
}
