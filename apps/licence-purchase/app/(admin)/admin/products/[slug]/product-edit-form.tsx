'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  toggleProductActive,
  updateProductDescription,
  updateProductDisplayOrder,
} from '../actions'

export function ProductEditForm({
  productId,
  initialDescription,
  initialDisplayOrder,
  initialIsActive,
}: {
  productId: string
  initialDescription: string
  initialDisplayOrder: number
  initialIsActive: boolean
}) {
  const [pending, start] = useTransition()
  const [description, setDescription] = useState(initialDescription)
  const [displayOrder, setDisplayOrder] = useState(String(initialDisplayOrder))
  const [isActive, setIsActive] = useState(initialIsActive)
  const [message, setMessage] = useState<string | null>(null)

  function save() {
    setMessage(null)
    start(async () => {
      try {
        await updateProductDescription({ productId, description })
        const order = Number.parseInt(displayOrder, 10)
        if (Number.isFinite(order)) {
          await updateProductDisplayOrder({ productId, displayOrder: order })
        }
        setMessage('Saved.')
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Save failed')
      }
    })
  }

  function toggle(next: boolean) {
    setIsActive(next)
    start(async () => {
      try {
        await toggleProductActive({ productId, isActive: next })
      } catch (err) {
        setIsActive(!next)
        setMessage(err instanceof Error ? err.message : 'Toggle failed')
      }
    })
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Customer-facing description shown on /products and /products/[slug]"
        />
      </div>

      <div className="grid gap-2 md:max-w-xs">
        <Label htmlFor="display-order">Display order</Label>
        <Input
          id="display-order"
          type="number"
          value={displayOrder}
          onChange={(e) => setDisplayOrder(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3">
        <Switch id="is-active" checked={isActive} onCheckedChange={toggle} />
        <Label htmlFor="is-active" className="cursor-pointer">
          Visible on storefront
        </Label>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
      </div>
    </div>
  )
}
