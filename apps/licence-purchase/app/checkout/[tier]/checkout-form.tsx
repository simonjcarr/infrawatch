'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { startCheckout } from '@/lib/actions/checkout'
import type { BillingInterval, PaidTierId, TierDefinition } from '@/lib/tiers'

type PaymentMethod = 'card' | 'bacs_debit' | 'invoice'

const PAYMENT_METHODS: { id: PaymentMethod; label: string; hint: string }[] = [
  { id: 'card', label: 'Credit / debit card', hint: 'Instant activation. Visa, Mastercard, Amex.' },
  {
    id: 'bacs_debit',
    label: 'BACS Direct Debit',
    hint: 'UK bank accounts, GBP only. 3-business-day settlement.',
  },
  {
    id: 'invoice',
    label: 'Pay by invoice (bank transfer)',
    hint: 'We email a hosted invoice; you pay by bank transfer within the invoice terms.',
  },
]

function formatGbp(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(amount)
}

export function CheckoutPanels({
  tier,
  tierDef,
  initialInterval,
}: {
  tier: PaidTierId
  tierDef: TierDefinition
  initialInterval: BillingInterval
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [interval, setInterval] = useState<BillingInterval>(initialInterval)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')

  const perMonth = tierDef.displayPrice[interval] ?? 0
  const annualisedTotal = interval === 'year' ? perMonth * 12 : perMonth

  function onSubmit() {
    setError(null)
    start(async () => {
      try {
        await startCheckout({ tier, interval, paymentMethod })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to start checkout')
      }
    })
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle className="capitalize">Buy {tierDef.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={onSubmit} className="grid gap-5">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium text-foreground">Billing interval</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['month', 'year'] as BillingInterval[]).map((i) => (
                  <label
                    key={i}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                      interval === i ? 'border-primary bg-primary/5' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="interval"
                      value={i}
                      checked={interval === i}
                      onChange={() => setInterval(i)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-medium capitalize text-foreground">
                        {i === 'year' ? 'Annual (save 20%)' : 'Monthly'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {i === 'year' ? 'Billed once per year.' : 'Billed monthly.'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium text-foreground">Payment method</legend>
              <div className="grid gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <label
                    key={m.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                      paymentMethod === m.id ? 'border-primary bg-primary/5' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value={m.id}
                      checked={paymentMethod === m.id}
                      onChange={() => setPaymentMethod(m.id)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-medium text-foreground">{m.label}</div>
                      <div className="text-xs text-muted-foreground">{m.hint}</div>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Button type="submit" disabled={pending} size="lg">
              {pending ? 'Redirecting to checkout…' : 'Continue to secure checkout'}
            </Button>
            <p className="text-xs text-muted-foreground">
              You&apos;ll be redirected to Stripe to enter payment details. We never see your card number.
            </p>
          </form>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Order summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Tier</span>
            <span className="font-medium capitalize">{tierDef.name}</span>
          </div>
          <div className="flex justify-between">
            <span>Billing</span>
            <span className="font-medium">
              {interval === 'year' ? 'Annual (save 20%)' : 'Monthly'}
            </span>
          </div>
          <div className="flex items-baseline justify-between pt-2">
            <span className="text-muted-foreground">Price</span>
            <span className="text-xl font-semibold">{formatGbp(perMonth)}<span className="text-sm font-normal text-muted-foreground"> / month</span></span>
          </div>
          {interval === 'year' ? (
            <p className="text-right text-xs text-muted-foreground">
              Billed annually at {formatGbp(annualisedTotal)}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            Final pricing and VAT will be confirmed on the Stripe checkout page.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
