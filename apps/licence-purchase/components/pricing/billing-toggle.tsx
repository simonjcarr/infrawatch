'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import type { BillingInterval } from '@/lib/billing'

export function BillingToggle({
  onChange,
  initialInterval = 'month',
}: {
  onChange?: (interval: BillingInterval) => void
  initialInterval?: BillingInterval
}) {
  const [isYearly, setIsYearly] = useState(initialInterval === 'year')

  function handle(checked: boolean) {
    setIsYearly(checked)
    onChange?.(checked ? 'year' : 'month')
  }

  return (
    <div className="inline-flex items-center gap-3 rounded-lg border bg-card px-4 py-2">
      <Label htmlFor="billing-toggle" className="cursor-pointer text-foreground">
        Monthly
      </Label>
      <Switch id="billing-toggle" checked={isYearly} onCheckedChange={handle} />
      <Label htmlFor="billing-toggle" className="cursor-pointer text-foreground">
        Annual
      </Label>
      <Badge variant="secondary">Save up to 20%</Badge>
    </div>
  )
}
