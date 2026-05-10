import { redirect } from 'next/navigation'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/shared/sidebar'
import { Topbar } from '@/components/shared/topbar'
import { CommandPaletteProvider } from '@/components/shared/command-palette'
import { getRequiredSession } from '@/lib/auth/session'
import { getInstanceEffectiveLicence } from '@/lib/actions/licence-guard'
import { TerminalProviderWrapper, TerminalContentWrapper } from '@/components/terminal/terminal-layout-wrapper'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getRequiredSession()

  if (session.user.email.endsWith('@ldap.local')) {
    redirect('/setup-email')
  }

  if (session.user.role === 'pending') {
    redirect('/pending-approval')
  }

  const licence = await getInstanceEffectiveLicence(session.user.instanceId)

  return (
    <CommandPaletteProvider userRole={session.user.role}>
      <TerminalProviderWrapper>
        <SidebarProvider className="h-svh overflow-hidden">
          <AppSidebar tier={licence.tier} userRole={session.user.role} />
          <TerminalContentWrapper>
            <Topbar />
            <main className="flex-1 p-6 overflow-auto min-h-0">{children}</main>
          </TerminalContentWrapper>
        </SidebarProvider>
      </TerminalProviderWrapper>
    </CommandPaletteProvider>
  )
}
