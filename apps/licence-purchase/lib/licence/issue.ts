import { and, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '@/lib/db'
import {
  contacts,
  licences,
  organisations,
  products,
  productTiers,
  purchases,
} from '@/lib/db/schema'
import type { Licence } from '@/lib/db/schema'
import { env } from '@/lib/env'
import { sendEmail } from '@/lib/email/client'
import { licenceReadyEmail } from '@/lib/email/templates/licence-ready'
import { signLicence } from './sign'

const DAY_MS = 24 * 60 * 60 * 1000

export type IssueLicenceInput = {
  purchaseId: string
  issuedAt?: Date
}

// Issues a fresh signed licence for a purchase. Called on first `invoice.paid`
// and again on each renewal period — every call mints a new JWT with a new jti
// so natural expiry (not mutation) drives revocation for air-gapped installs.
export async function issueLicence(input: IssueLicenceInput): Promise<Licence> {
  const purchase = await db.query.purchases.findFirst({
    where: eq(purchases.id, input.purchaseId),
  })
  if (!purchase) {
    throw new Error(`Purchase ${input.purchaseId} not found`)
  }
  if (purchase.interval !== 'month' && purchase.interval !== 'year') {
    throw new Error(`Purchase ${purchase.id} has invalid interval: ${purchase.interval}`)
  }
  if (!purchase.productTierId) {
    throw new Error(
      `Purchase ${purchase.id} has no product tier — the checkout metadata is missing catalog references`,
    )
  }

  const tier = await db.query.productTiers.findFirst({
    where: eq(productTiers.id, purchase.productTierId),
  })
  if (!tier) {
    throw new Error(`Product tier ${purchase.productTierId} not found`)
  }
  if (tier.features.length === 0) {
    throw new Error(`Product tier ${tier.id} has no features — cannot issue a licence`)
  }

  const product = await db.query.products.findFirst({
    where: eq(products.id, tier.productId),
  })
  if (!product) {
    throw new Error(`Product ${tier.productId} not found`)
  }

  const organisation = await db.query.organisations.findFirst({
    where: eq(organisations.id, purchase.organisationId),
  })
  if (!organisation) {
    throw new Error(`Organisation ${purchase.organisationId} not found`)
  }

  const technicalContact = await db.query.contacts.findFirst({
    where: and(eq(contacts.organisationId, organisation.id), eq(contacts.role, 'technical')),
  })
  if (!technicalContact) {
    throw new Error(
      `Organisation ${organisation.id} has no technical contact — add one before issuing a licence`,
    )
  }

  if (!purchase.installOrganisationId) {
    throw new Error(
      `Purchase ${purchase.id} has no install organisation id — checkout must capture an activation token before a licence can be issued`,
    )
  }

  const issuedAt = input.issuedAt ?? new Date()
  const termDays = purchase.interval === 'year' ? env.licenceYearlyDays : env.licenceMonthlyDays
  const expiresAt = new Date(issuedAt.getTime() + termDays * DAY_MS)

  const jti = createId()
  const features = tier.features

  const signed = await signLicence({
    installOrganisationId: purchase.installOrganisationId,
    customer: {
      name: purchase.installOrganisationName ?? organisation.name,
      email: technicalContact.email,
    },
    productSlug: product.slug,
    tier: tier.tierSlug,
    features,
    jti,
    issuedAt,
    expiresAt,
  })

  const [inserted] = await db
    .insert(licences)
    .values({
      jti,
      organisationId: organisation.id,
      purchaseId: purchase.id,
      productId: product.id,
      productTierId: tier.id,
      tier: tier.tierSlug,
      features,
      signedJwt: signed.jwt,
      issuedAt,
      expiresAt,
    })
    .returning()

  if (!inserted) {
    throw new Error('Failed to persist issued licence')
  }

  const email = licenceReadyEmail({
    organisationName: organisation.name,
    dashboardUrl: `${env.appUrl}/dashboard`,
  })
  await sendEmail({
    to: technicalContact.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: env.supportEmail,
  })

  return inserted
}
