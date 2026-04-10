import { redirect } from 'next/navigation'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/shared/sidebar'
import { Topbar } from '@/components/shared/topbar'
import { getRequiredSession } from '@/lib/auth/session'

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

  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <Topbar />
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </SidebarProvider>
  )
}
