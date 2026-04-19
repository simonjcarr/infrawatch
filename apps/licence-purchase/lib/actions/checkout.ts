'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { createCheckoutSession } from '@/lib/stripe/create-checkout-session'
import { env } from '@/lib/env'

const schema = z.object({
  tier: z.enum(['pro', 'enterprise']),
  interval: z.enum(['month', 'year']),
  paymentMethod: z.enum(['card', 'bacs_debit', 'invoice']),
})

export async function startCheckout(input: unknown): Promise<void> {
  const parsed = schema.parse(input)
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
    successUrl: `${env.appUrl}/checkout/success?tier=${parsed.tier}`,
    cancelUrl: `${env.appUrl}/checkout/cancelled`,
  })

  redirect(session.url)
}
