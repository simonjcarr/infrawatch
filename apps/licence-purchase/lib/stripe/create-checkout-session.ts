import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { products, productTiers, productTierPrices } from '@/lib/db/schema'
import { env } from '@/lib/env'
import type { BillingInterval } from '@/lib/billing'
import { stripe } from './client'
import { ensureStripeCustomer } from './ensure-customer'

export type PaymentMethodChoice = 'card' | 'bacs_debit' | 'invoice'

export type CreateCheckoutSessionInput = {
  productSlug: string
  tierSlug: string
  interval: BillingInterval
  paymentMethod: PaymentMethodChoice
  organisationId: string
  customerEmail: string
  customerName?: string | null
  install: {
    organisationId: string
    organisationName: string
    nonce: string
  }
  successUrl: string
  cancelUrl: string
}

export type CreateCheckoutSessionResult = {
  url: string
  sessionId: string
}

export type ResolvedTierPrice = {
  productId: string
  productSlug: string
  productName: string
  tierId: string
  tierSlug: string
  tierName: string
  features: string[]
  priceRowId: string
  stripePriceId: string
  unitAmount: number
  currency: string
}

// Joins product + tier + price by slug, filtered on active everywhere. Throws
// a user-visible error if any part of the chain is missing or inactive, so the
// route can render "this plan is no longer available".
export async function resolveTierPrice(args: {
  productSlug: string
  tierSlug: string
  interval: BillingInterval
}): Promise<ResolvedTierPrice> {
  const product = await db.query.products.findFirst({
    where: and(eq(products.slug, args.productSlug), eq(products.isActive, true)),
  })
  if (!product) {
    throw new Error(`Product "${args.productSlug}" is not available`)
  }
  const tier = await db.query.productTiers.findFirst({
    where: and(
      eq(productTiers.productId, product.id),
      eq(productTiers.tierSlug, args.tierSlug),
      eq(productTiers.isActive, true),
    ),
  })
  if (!tier) {
    throw new Error(`This plan is no longer available`)
  }
  const priceRow = await db.query.productTierPrices.findFirst({
    where: and(
      eq(productTierPrices.tierId, tier.id),
      eq(productTierPrices.interval, args.interval),
      eq(productTierPrices.isActive, true),
    ),
  })
  if (!priceRow) {
    throw new Error(`No active ${args.interval} price for this plan`)
  }
  if (tier.features.length === 0) {
    // A tier with no features would mint a licence that unlocks nothing —
    // safer to block the sale than ship a broken licence.
    throw new Error(`This plan is misconfigured (no features). Please contact support.`)
  }
  return {
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    tierId: tier.id,
    tierSlug: tier.tierSlug,
    tierName: tier.name,
    features: tier.features,
    priceRowId: priceRow.id,
    stripePriceId: priceRow.stripePriceId,
    unitAmount: priceRow.unitAmount,
    currency: priceRow.currency,
  }
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  const resolved = await resolveTierPrice({
    productSlug: input.productSlug,
    tierSlug: input.tierSlug,
    interval: input.interval,
  })

  const customerId = await ensureStripeCustomer({
    organisationId: input.organisationId,
    email: input.customerEmail,
    name: input.customerName ?? null,
  })

  const metadata: Record<string, string> = {
    organisationId: input.organisationId,
    carrtechProductSlug: resolved.productSlug,
    carrtechProductId: resolved.productId,
    productTierId: resolved.tierId,
    productTierPriceId: resolved.priceRowId,
    tierSlug: resolved.tierSlug,
    tier: resolved.tierSlug,
    interval: input.interval,
    paymentMethod: input.paymentMethod,
    installOrganisationId: input.install.organisationId,
    installOrganisationName: input.install.organisationName,
    activationNonce: input.install.nonce,
  }

  if (input.paymentMethod === 'invoice') {
    const subscription = await stripe().subscriptions.create({
      customer: customerId,
      items: [{ price: resolved.stripePriceId, quantity: 1 }],
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
    line_items: [{ price: resolved.stripePriceId, quantity: 1 }],
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
