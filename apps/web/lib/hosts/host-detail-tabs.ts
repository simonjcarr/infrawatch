export type ParentTabId =
  | 'overview'
  | 'monitoring'
  | 'infrastructure'
  | 'inventory'
  | 'notes'
  | 'management'
  | 'tools'

export type Tab =
  | 'overview'
  | 'storage'
  | 'network'
  | 'patch-status'
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
  | 'notes'

export const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  storage: 'Storage',
  network: 'Network',
  'patch-status': 'Patch Status',
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
  notes: 'Notes',
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
  { id: 'inventory', label: 'Inventory', defaultTab: 'packages', children: ['packages'] },
  { id: 'notes', label: 'Notes', defaultTab: 'notes', children: null },
  { id: 'management', label: 'Management', defaultTab: 'groups', children: ['users', 'groups', 'settings'] },
  { id: 'tools', label: 'Tools', defaultTab: 'tasks', children: ['tasks', 'logs', 'terminal'] },
]
