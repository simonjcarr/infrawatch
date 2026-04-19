import type Stripe from 'stripe'
import { and, desc, eq, gte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { invoices, organisations, purchases, contacts } from '@/lib/db/schema'
import type { Purchase } from '@/lib/db/schema'
import { issueLicence } from '@/lib/licence/issue'
import { licences } from '@/lib/db/schema'
import { sendEmail } from '@/lib/email/client'
import { receiptEmail } from '@/lib/email/templates/receipt'
import { paymentFailedEmail } from '@/lib/email/templates/payment-failed'
import { stripe } from '@/lib/stripe/client'
import { env } from '@/lib/env'

// Dispatches a Stripe webhook event to the appropriate handler. Each handler
// is written to be idempotent so duplicate deliveries don't corrupt state.
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session)
      return
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await onSubscriptionUpserted(event.data.object as Stripe.Subscription)
      return
    case 'customer.subscription.deleted':
      await onSubscriptionDeleted(event.data.object as Stripe.Subscription)
      return
    case 'invoice.paid':
      await onInvoicePaid(event.data.object as Stripe.Invoice)
      return
    case 'invoice.payment_failed':
      await onInvoicePaymentFailed(event.data.object as Stripe.Invoice)
      return
    default:
      // Event persisted by the route — safe to ignore unhandled types.
      return
  }
}

// ── checkout.session.completed ────────────────────────────────────────────────
// Fires for card / bacs_debit flows. Links the subscription to the org. The
// actual purchase row is created/updated by customer.subscription.created|updated,
// which always fires for both flows (including send_invoice).
async function onCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const organisationId = session.client_reference_id ?? session.metadata?.['organisationId']
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  if (!organisationId || !customerId) return

  await db
    .update(organisations)
    .set({ stripeCustomerId: customerId, updatedAt: new Date() })
    .where(eq(organisations.id, organisationId))
}

// ── customer.subscription.created / updated ───────────────────────────────────
// Creates the purchase row on first arrival, updates period/status on later
// firings. Treated as one handler because Stripe sometimes collapses the two.
async function onSubscriptionUpserted(subscription: Stripe.Subscription): Promise<void> {
  const meta = subscription.metadata ?? {}
  const organisationId = meta['organisationId']
  const tier = meta['tier']
  const interval = meta['interval']
  const paymentMethod = meta['paymentMethod'] ?? 'card'
  if (!organisationId || !tier || !interval) return

  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id

  const item = subscription.items.data[0]
  const currentPeriodStart = toDate(item?.current_period_start ?? null)
  const currentPeriodEnd = toDate(item?.current_period_end ?? null)
  const cancelAt = toDate(subscription.cancel_at ?? null)

  const existing = await db.query.purchases.findFirst({
    where: eq(purchases.stripeSubscriptionId, subscription.id),
  })

  if (existing) {
    await db
      .update(purchases)
      .set({
        status: subscription.status,
        ...(currentPeriodStart ? { currentPeriodStart } : {}),
        ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
        cancelAt,
        updatedAt: new Date(),
      })
      .where(eq(purchases.id, existing.id))
    return
  }

  await db.insert(purchases).values({
    organisationId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    tier,
    interval,
    status: subscription.status,
    paymentMethod,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAt,
  })
}

async function onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  await db
    .update(purchases)
    .set({ status: 'canceled', updatedAt: new Date() })
    .where(eq(purchases.stripeSubscriptionId, subscription.id))
}

// ── invoice.paid ──────────────────────────────────────────────────────────────
// Upserts the invoice row and issues a licence for the current period.
// Idempotent: if a licence already exists covering this billing period, skip.
async function onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = getInvoiceSubscriptionId(invoice)
  if (!subscriptionId) return

  // Stripe commonly delivers invoice.paid before customer.subscription.created.
  // If the purchase row is missing, fetch the subscription directly and create
  // it inline so we're order-independent.
  let purchase = await db.query.purchases.findFirst({
    where: eq(purchases.stripeSubscriptionId, subscriptionId),
  })
  if (!purchase) {
    const subscription = await stripe().subscriptions.retrieve(subscriptionId)
    await onSubscriptionUpserted(subscription)
    purchase = await db.query.purchases.findFirst({
      where: eq(purchases.stripeSubscriptionId, subscriptionId),
    })
  }
  if (!purchase) {
    // Metadata missing — nothing we can do with this invoice.
    return
  }

  const invoiceRow = await upsertInvoice(invoice, purchase.id)

  await db
    .update(purchases)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(purchases.id, purchase.id))

  await maybeIssueLicenceForPeriod(purchase, invoice)
  await sendReceipt(purchase.organisationId, invoice, invoiceRow.hostedInvoiceUrl)
}

async function onInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = getInvoiceSubscriptionId(invoice)
  if (!subscriptionId) return

  const purchase = await db.query.purchases.findFirst({
    where: eq(purchases.stripeSubscriptionId, subscriptionId),
  })
  if (!purchase) return

  await upsertInvoice(invoice, purchase.id)
  await db
    .update(purchases)
    .set({ status: 'past_due', updatedAt: new Date() })
    .where(eq(purchases.id, purchase.id))

  await sendPaymentFailedNotice(purchase.organisationId, invoice)
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toDate(unix: number | null): Date | null {
  if (unix === null || unix === undefined) return null
  return new Date(unix * 1000)
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent as { subscription_details?: { subscription?: string | Stripe.Subscription } } | null
  const ref = parent?.subscription_details?.subscription
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

async function upsertInvoice(invoice: Stripe.Invoice, purchaseId: string) {
  const values = {
    purchaseId,
    stripeInvoiceId: invoice.id!,
    number: invoice.number ?? null,
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
    status: invoice.status ?? 'open',
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    pdfUrl: invoice.invoice_pdf ?? null,
    issuedAt: toDate(invoice.created),
    paidAt: invoice.status === 'paid' ? new Date() : null,
  }

  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.stripeInvoiceId, invoice.id!),
  })

  if (existing) {
    await db
      .update(invoices)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(invoices.id, existing.id))
    return { ...existing, ...values }
  }

  const [inserted] = await db.insert(invoices).values(values).returning()
  if (!inserted) throw new Error(`Failed to persist invoice ${invoice.id}`)
  return inserted
}

async function maybeIssueLicenceForPeriod(
  purchase: Purchase,
  invoice: Stripe.Invoice,
): Promise<void> {
  const periodStart = invoice.period_start ? toDate(invoice.period_start) : null
  const boundary = periodStart ?? purchase.currentPeriodStart ?? new Date(Date.now() - 60 * 60 * 1000)

  const existing = await db.query.licences.findFirst({
    where: and(
      eq(licences.purchaseId, purchase.id),
      gte(licences.issuedAt, boundary),
    ),
    orderBy: [desc(licences.issuedAt)],
  })
  if (existing) return

  await issueLicence({ purchaseId: purchase.id })
}

async function sendReceipt(
  organisationId: string,
  invoice: Stripe.Invoice,
  hostedInvoiceUrl: string | null,
): Promise<void> {
  const billing = await db.query.contacts.findFirst({
    where: and(eq(contacts.organisationId, organisationId), eq(contacts.role, 'billing')),
  })
  const to = billing?.email
  if (!to) return

  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, organisationId),
  })
  const tmpl = receiptEmail({
    organisationName: org?.name ?? 'your organisation',
    invoiceNumber: invoice.number ?? invoice.id ?? 'n/a',
    amount: formatAmount(invoice.amount_paid, invoice.currency),
    invoiceUrl: hostedInvoiceUrl ?? invoice.hosted_invoice_url ?? '#',
  })
  await sendEmail({ to, subject: tmpl.subject, html: tmpl.html, text: tmpl.text, replyTo: env.supportEmail })
}

async function sendPaymentFailedNotice(
  organisationId: string,
  invoice: Stripe.Invoice,
): Promise<void> {
  const billing = await db.query.contacts.findFirst({
    where: and(eq(contacts.organisationId, organisationId), eq(contacts.role, 'billing')),
  })
  if (!billing?.email) return
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, organisationId),
  })
  const tmpl = paymentFailedEmail({
    organisationName: org?.name ?? 'your organisation',
    invoiceUrl: invoice.hosted_invoice_url ?? '#',
  })
  const to = env.opsNotificationEmail
    ? [billing.email, env.opsNotificationEmail]
    : billing.email
  await sendEmail({ to, subject: tmpl.subject, html: tmpl.html, text: tmpl.text, replyTo: env.supportEmail })
}

function formatAmount(amountInSmallestUnit: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amountInSmallestUnit / 100)
  } catch {
    return `${(amountInSmallestUnit / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}
