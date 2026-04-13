'use client'

import { TerminalPanelProvider } from './terminal-panel-context'
import { TerminalPanel } from './terminal-panel'

/**
 * Wraps the entire dashboard (sidebar + content) so that both the sidebar's
 * TerminalPanelTrigger and the main content can access the terminal context.
 */
export function TerminalProviderWrapper({ children }: { children: React.ReactNode }) {
  return <TerminalPanelProvider>{children}</TerminalPanelProvider>
}

/**
 * Inner wrapper for the main content column. Renders the TerminalPanel at the
 * bottom and lets the page content shrink to fit.
 */
export function TerminalContentWrapper({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {children}
      <TerminalPanel orgId={orgId} />
    </div>
  )
}
