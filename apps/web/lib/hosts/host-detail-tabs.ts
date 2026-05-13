export type ParentTabId =
  | 'overview'
  | 'monitoring'
  | 'infrastructure'
  | 'inventory'
  | 'containers'
  | 'admin'
  | 'management'
  | 'tools'

export type Tab =
  | 'overview'
  | 'storage'
  | 'network'
  | 'patch-status'
  | 'vulnerabilities'
  | 'metrics'
  | 'checks'
  | 'alerts'
  | 'users'
  | 'settings'
  | 'groups'
  | 'host-networks'
  | 'tasks'
  | 'logs'
  | 'terminal'
  | 'packages'
  | 'containers'
  | 'notes'
  | 'calendar'

export const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  storage: 'Storage',
  network: 'Network',
  'patch-status': 'Patch Status',
  vulnerabilities: 'Vulnerabilities',
  metrics: 'Metrics',
  checks: 'Checks',
  alerts: 'Alerts',
  users: 'Users',
  settings: 'Settings',
  groups: 'Groups',
  'host-networks': 'Networks',
  tasks: 'Tasks',
  logs: 'Logs',
  terminal: 'Terminal',
  packages: 'Packages',
  containers: 'Containers',
  notes: 'Notes',
  calendar: 'Calendar',
}

export const PARENT_TABS: Array<{
  id: ParentTabId
  label: string
  defaultTab: Tab
  children: Tab[] | null
}> = [
  { id: 'overview', label: 'Overview', defaultTab: 'overview', children: null },
  { id: 'monitoring', label: 'Monitoring', defaultTab: 'metrics', children: ['metrics', 'checks', 'alerts'] },
  { id: 'infrastructure', label: 'Infrastructure', defaultTab: 'storage', children: ['storage', 'network', 'host-networks', 'patch-status'] },
  { id: 'inventory', label: 'Inventory', defaultTab: 'packages', children: ['packages', 'vulnerabilities'] },
  { id: 'containers', label: 'Containers', defaultTab: 'containers', children: null },
  { id: 'admin', label: 'Admin', defaultTab: 'notes', children: ['notes', 'calendar'] },
  { id: 'management', label: 'Management', defaultTab: 'groups', children: ['users', 'groups', 'settings'] },
  { id: 'tools', label: 'Tools', defaultTab: 'tasks', children: ['tasks', 'logs', 'terminal'] },
]
