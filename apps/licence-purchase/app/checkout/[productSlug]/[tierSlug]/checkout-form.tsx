'use client'

import { useMemo, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { startCheckout } from '@/lib/actions/checkout'
import { formatPrice, type BillingInterval } from '@/lib/billing'
import type { ProductTierPrice } from '@/lib/db/schema'

const ACTIVATION_TOKEN_PREFIX = 'infw-act_'

function previewInstallName(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith(ACTIVATION_TOKEN_PREFIX)) return null
  try {
    const body = trimmed.slice(ACTIVATION_TOKEN_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')
    const pad = body.length % 4 === 0 ? '' : '='.repeat(4 - (body.length % 4))
    const json = JSON.parse(atob(body + pad)) as { installOrgName?: unknown }
    return typeof json.installOrgName === 'string' ? json.installOrgName : null
  } catch {
    return null
  }
}

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

export function CheckoutPanels({
  productSlug,
  productName,
  tierSlug,
  tierName,
  prices,
  initialInterval,
}: {
  productSlug: string
  productName: string
  tierSlug: string
  tierName: string
  prices: ProductTierPrice[]
  initialInterval: BillingInterval
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [interval, setInterval] = useState<BillingInterval>(initialInterval)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')
  const [activationToken, setActivationToken] = useState('')

  const activePrice = useMemo(
    () => prices.find((p) => p.interval === interval && p.isActive),
    [prices, interval],
  )
  const displayPrice = activePrice
    ? formatPrice(activePrice.unitAmount, activePrice.currency)
    : null
  const intervalSuffix = interval === 'year' ? '/ year' : '/ month'

  const installName = useMemo(() => previewInstallName(activationToken), [activationToken])
  const tokenLooksValid = installName !== null
  const tokenEntered = activationToken.trim().length > 0

  function onSubmit() {
    setError(null)
    if (!tokenEntered) {
      setError('Paste the activation token from your Infrawatch install before continuing.')
      return
    }
    if (!activePrice) {
      setError(`No ${interval} price is configured for this plan.`)
      return
    }
    start(async () => {
      try {
        const result = await startCheckout({
          productSlug,
          tierSlug,
          interval,
          paymentMethod,
          activationToken: activationToken.trim(),
        })
        if (result && 'error' in result) {
          setError(result.error)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to start checkout')
      }
    })
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Buy {productName} {tierName}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={onSubmit} className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="activation-token">Activation token</Label>
              <textarea
                id="activation-token"
                value={activationToken}
                onChange={(e) => setActivationToken(e.target.value)}
                placeholder="Paste the infw-act_… token from your Infrawatch install (Settings → Licence)"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {tokenEntered && !tokenLooksValid ? (
                <p className="text-xs text-destructive">
                  That doesn&apos;t look like a valid activation token. Copy it from your install&apos;s Settings → Licence screen.
                </p>
              ) : null}
              {tokenLooksValid ? (
                <p className="text-xs text-muted-foreground">
                  Binding licence to: <strong className="text-foreground">{installName}</strong>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The licence will be bound to the install that generated this token and can&apos;t be used elsewhere.
                </p>
              )}
            </div>

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
                        {i === 'year' ? 'Annual' : 'Monthly'}
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

            <Button type="submit" disabled={pending || !tokenEntered || !activePrice} size="lg">
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
            <span>Product</span>
            <span className="font-medium">{productName}</span>
          </div>
          <div className="flex justify-between">
            <span>Tier</span>
            <span className="font-medium">{tierName}</span>
          </div>
          <div className="flex justify-between">
            <span>Billing</span>
            <span className="font-medium">{interval === 'year' ? 'Annual' : 'Monthly'}</span>
          </div>
          <div className="flex items-baseline justify-between pt-2">
            <span className="text-muted-foreground">Price</span>
            {displayPrice ? (
              <span className="text-xl font-semibold">
                {displayPrice}
                <span className="text-sm font-normal text-muted-foreground"> {intervalSuffix}</span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Price unavailable</span>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            VAT will be confirmed on the Stripe checkout page.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
