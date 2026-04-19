'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { createCheckoutSession } from '@/lib/stripe/create-checkout-session'
import { decodeActivationToken } from '@/lib/licence/activation-token'
import { env } from '@/lib/env'

const schema = z.object({
  tier: z.enum(['pro', 'enterprise']),
  interval: z.enum(['month', 'year']),
  paymentMethod: z.enum(['card', 'bacs_debit', 'invoice']),
  activationToken: z.string().min(1, 'Activation token is required'),
})

export type StartCheckoutResult = { error: string }

export async function startCheckout(input: unknown): Promise<StartCheckoutResult | void> {
  const safe = schema.safeParse(input)
  if (!safe.success) {
    return { error: safe.error.issues[0]?.message ?? 'Invalid checkout input' }
  }
  const parsed = safe.data

  const decoded = decodeActivationToken(parsed.activationToken)
  if (!decoded.ok) {
    return { error: decoded.error }
  }

  const { user } = await getRequiredSession()
  if (!user.organisationId) {
    redirect('/account?reason=missing-organisation')
  }

  const session = await createCheckoutSession({
    tier: parsed.tier,
    interval: parsed.interval,
    paymentMethod: parsed.paymentMethod,
    organisationId: user.organisationId,
    customerEmail: user.email,
    customerName: user.name,
    install: {
      organisationId: decoded.payload.installOrgId,
      organisationName: decoded.payload.installOrgName,
      nonce: decoded.payload.nonce,
    },
    successUrl: `${env.appUrl}/checkout/success?tier=${parsed.tier}`,
    cancelUrl: `${env.appUrl}/checkout/cancelled`,
  })

  redirect(session.url)
}
