import { KeyRound } from 'lucide-react'

export const PASSWORD_GENERATOR_NAV_ITEM = {
  title: 'Password Generator',
  href: '/password-generator',
  icon: KeyRound,
  testId: 'sidebar-password-generator',
} as const

export const PASSWORD_GENERATOR_COMMAND_ITEM = {
  id: 'nav-password-generator',
  label: 'Password Generator',
  icon: KeyRound,
  href: '/password-generator',
  keywords: ['password', 'generator', 'secrets', 'credentials', 'tooling'] as string[],
} as const
