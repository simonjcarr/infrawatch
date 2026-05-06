import { Lock } from 'lucide-react'

export const PASSWORD_MANAGER_NAV_ITEM = {
  title: 'Password Manager',
  href: '/password-manager',
  icon: Lock,
  prefetch: false,
  testId: 'sidebar-password-manager',
} as const

export const PASSWORD_MANAGER_COMMAND_ITEM = {
  id: 'nav-password-manager',
  label: 'Password Manager',
  icon: Lock,
  href: '/password-manager',
  keywords: ['vault', 'secrets', 'credentials', 'tooling'] as string[],
} as const
