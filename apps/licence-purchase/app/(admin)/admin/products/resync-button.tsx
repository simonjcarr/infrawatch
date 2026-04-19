'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { resyncFromStripe } from './actions'
import type { SyncResult } from '@/lib/stripe/sync-catalog'

export function ResyncButton() {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function run() {
    setError(null)
    setResult(null)
    start(async () => {
      try {
        const r = await resyncFromStripe()
        setResult(r)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sync failed')
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={run} disabled={pending}>
        {pending ? 'Syncing…' : 'Resync from Stripe'}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {result ? (
        <p className="text-xs text-muted-foreground">
          Products {result.productsUpserted} · Tiers {result.tiersUpserted} · Prices{' '}
          {result.pricesUpserted} · Warnings {result.warnings.length}
        </p>
      ) : null}
    </div>
  )
}
