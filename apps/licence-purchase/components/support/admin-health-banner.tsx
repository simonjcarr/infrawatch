import Link from 'next/link'
import { getSupportHealth } from '@/lib/actions/support'
import { TicketAutoRefresh } from './ticket-auto-refresh'

// Always-visible admin health strip. Rendered from the admin layout so it
// appears on every admin page. Auto-refreshes in the background so counts
// update without a manual reload. Hidden entirely when everything is clean.
export async function AdminHealthBanner() {
  const health = await getSupportHealth()
  const { unansweredCount, flaggedCount, flagged } = health
  const needsAttention = unansweredCount > 0 || flaggedCount > 0
  if (!needsAttention) return <TicketAutoRefresh intervalMs={30_000} />

  return (
    <>
      <TicketAutoRefresh intervalMs={15_000} />
      <div className="border-b border-amber-500/40 bg-amber-500/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
          <span className="font-semibold uppercase tracking-wide">Support</span>
          {unansweredCount > 0 ? (
            <Link
              href="/admin/support"
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/30 px-2.5 py-0.5 font-medium hover:bg-amber-500/40"
            >
              <span className="tabular-nums">{unansweredCount}</span>
              <span>awaiting staff reply</span>
            </Link>
          ) : null}
          {flaggedCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-0.5 font-medium text-red-900 dark:text-red-200">
              <span className="tabular-nums">{flaggedCount}</span>
              <span>AI error{flaggedCount === 1 ? '' : 's'}</span>
            </span>
          ) : null}
          {flagged.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {flagged.map((t) => (
                <Link
                  key={t.id}
                  href={`/admin/support/${t.id}`}
                  title={t.flagReason ?? undefined}
                  className="inline-flex max-w-[24ch] items-center gap-1 rounded border border-red-500/40 bg-background/50 px-2 py-0.5 text-xs text-foreground hover:bg-background"
                >
                  <span className="truncate">{t.subject}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
