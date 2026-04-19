'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { getRecentLicenceIdForCurrentUser } from '@/lib/actions/licences'

type Props = {
  tier?: string
  isInvoiceFlow: boolean
}

// Polls for the licence that Stripe's webhook will create once payment clears.
// As soon as a licence appears, we hard-navigate to /dashboard so the user
// sees it in their list without having to click anything.
export function AwaitLicence({ tier, isInvoiceFlow }: Props) {
  const router = useRouter()
  const [elapsed, setElapsed] = useState(0)
  const redirected = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      if (cancelled) return
      try {
        const id = await getRecentLicenceIdForCurrentUser()
        if (id && !redirected.current) {
          redirected.current = true
          router.replace('/dashboard')
          return
        }
      } catch {
        // transient — keep polling
      }
      if (!cancelled) {
        setElapsed((n) => n + 1)
        timer = setTimeout(poll, 2000)
      }
    }

    let timer = setTimeout(poll, 1000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [router])

  // After ~20 polling cycles (~40s) for invoice flow, stop promising imminent
  // redirect — invoice payment can take days to clear.
  const longWait = elapsed > 20

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary/10">
          {isInvoiceFlow ? (
            <Clock className="size-5 text-primary" aria-hidden />
          ) : (
            <Loader2 className="size-5 text-primary animate-spin" aria-hidden />
          )}
        </div>
        <CardTitle>
          {isInvoiceFlow ? 'Invoice issued' : 'Processing your payment'}
        </CardTitle>
        <CardDescription>
          {isInvoiceFlow
            ? 'Check your email for the invoice. Your licence will be issued as soon as payment clears — this page will update automatically.'
            : longWait
              ? 'Still waiting for Stripe to confirm. You can leave this page — your licence will be emailed as soon as it is ready.'
              : 'Waiting for Stripe to confirm your payment. You will be taken to your licences as soon as it is ready.'}
          {tier ? <> Tier: <strong className="capitalize">{tier}</strong>.</> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 justify-center">
        <Button asChild variant="outline">
          <Link href="/dashboard">Go to dashboard now</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
