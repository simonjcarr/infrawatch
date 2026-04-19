'use client'

import { useState, useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { togglePriceActive, toggleTierActive } from '../actions'

export function ToggleRow({
  kind,
  id,
  isActive,
}: {
  kind: 'tier' | 'price'
  id: string
  isActive: boolean
}) {
  const [pending, start] = useTransition()
  const [state, setState] = useState(isActive)

  function change(next: boolean) {
    setState(next)
    start(async () => {
      try {
        if (kind === 'tier') {
          await toggleTierActive({ tierId: id, isActive: next })
        } else {
          await togglePriceActive({ priceId: id, isActive: next })
        }
      } catch {
        setState(!next)
      }
    })
  }

  return <Switch checked={state} onCheckedChange={change} disabled={pending} />
}
