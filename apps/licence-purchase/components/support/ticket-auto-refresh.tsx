'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Polls the server component that renders this page by calling router.refresh()
// on an interval. React Server Components stream only the changed payload back,
// so this is cheaper than a full reload and preserves scroll position.
//
// Pauses while the tab is hidden so we don't burn cycles polling a page nobody
// is looking at, and resumes on visibility change.
export function TicketAutoRefresh({
  intervalMs = 5000,
  enabled = true,
}: {
  intervalMs?: number
  enabled?: boolean
}) {
  const router = useRouter()

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    function tick() {
      if (cancelled) return
      if (document.visibilityState !== 'visible') return
      router.refresh()
    }

    const id = window.setInterval(tick, intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [router, intervalMs, enabled])

  return null
}
