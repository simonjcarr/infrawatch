import { redirect } from 'next/navigation'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/shared/sidebar'
import { Topbar } from '@/components/shared/topbar'
import { getRequiredSession } from '@/lib/auth/session'
import { TerminalProviderWrapper, TerminalContentWrapper } from '@/components/terminal/terminal-layout-wrapper'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getRequiredSession()

  if (session.user.email.endsWith('@ldap.local')) {
    redirect('/setup-email')
  }

  if (session.user.role === 'pending') {
    redirect('/pending-approval')
  }

  if (!session.user.organisationId) {
    redirect('/onboarding')
  }

  const orgId = session.user.organisationId

  return (
    <TerminalProviderWrapper>
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar orgId={orgId} />
        <TerminalContentWrapper orgId={orgId}>
          <Topbar orgId={orgId} />
          <main className="flex-1 p-6 overflow-auto min-h-0">{children}</main>
        </TerminalContentWrapper>
      </SidebarProvider>
    </TerminalProviderWrapper>
  )
}
