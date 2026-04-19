import type Stripe from 'stripe'
import { env } from '@/lib/env'
import type { BillingInterval, PaidTierId } from '@/lib/tiers'
import { stripe } from './client'
import { ensureStripeCustomer } from './ensure-customer'

export type PaymentMethodChoice = 'card' | 'bacs_debit' | 'invoice'

export type CreateCheckoutSessionInput = {
  tier: PaidTierId
  interval: BillingInterval
  paymentMethod: PaymentMethodChoice
  organisationId: string
  customerEmail: string
  customerName?: string | null
  successUrl: string
  cancelUrl: string
}

export type CreateCheckoutSessionResult = {
  url: string
  sessionId: string
}

function resolvePriceId(tier: PaidTierId, interval: BillingInterval): string {
  const priceId = env.stripePrices[tier][interval]
  if (!priceId) {
    const envVar = `STRIPE_PRICE_${tier.toUpperCase()}_${interval === 'month' ? 'MONTHLY' : 'YEARLY'}`
    throw new Error(`Missing Stripe price id for ${tier}/${interval} — set ${envVar}`)
  }
  return priceId
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  const priceId = resolvePriceId(input.tier, input.interval)

  const customerId = await ensureStripeCustomer({
    organisationId: input.organisationId,
    email: input.customerEmail,
    name: input.customerName ?? null,
  })

  const metadata: Record<string, string> = {
    organisationId: input.organisationId,
    tier: input.tier,
    interval: input.interval,
    paymentMethod: input.paymentMethod,
  }

  if (input.paymentMethod === 'invoice') {
    const subscription = await stripe().subscriptions.create({
      customer: customerId,
      items: [{ price: priceId, quantity: 1 }],
      collection_method: 'send_invoice',
      days_until_due: env.stripeInvoiceCollectionDays,
      metadata,
      ...(env.stripeTaxEnabled ? { automatic_tax: { enabled: true } } : {}),
    })

    const latestInvoiceRef: string | Stripe.Invoice | null = subscription.latest_invoice
    const latestInvoiceId =
      typeof latestInvoiceRef === 'string' ? latestInvoiceRef : latestInvoiceRef?.id
    if (!latestInvoiceId) {
      throw new Error('Stripe did not attach an invoice to the new subscription')
    }
    const invoice = await stripe().invoices.retrieve(latestInvoiceId)
    const url = invoice.hosted_invoice_url
    if (!url) {
      throw new Error('Stripe invoice is missing a hosted_invoice_url')
    }
    return { url, sessionId: subscription.id }
  }

  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: [input.paymentMethod],
    line_items: [{ price: priceId, quantity: 1 }],
    customer: customerId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.organisationId,
    metadata,
    subscription_data: { metadata },
    ...(env.stripeTaxEnabled ? { automatic_tax: { enabled: true } } : {}),
  })

  if (!session.url) {
    throw new Error('Stripe did not return a Checkout URL')
  }
  return { url: session.url, sessionId: session.id }
}
