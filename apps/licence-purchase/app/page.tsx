import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Nav } from '@/components/shared/nav'
import { Footer } from '@/components/shared/footer'
import { TrustBadges } from '@/components/shared/trust-badges'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { getOptionalSession } from '@/lib/auth/session'

export default async function LandingPage() {
  const session = await getOptionalSession()

  return (
    <div className="flex min-h-screen flex-col">
      <Nav isAuthenticated={!!session} />

      <main className="flex-1">
        <section className="border-b">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
            <div className="flex flex-col justify-center">
              <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" aria-hidden />
                Offline-capable, JWT-signed licences
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                Licences for CarrTech.dev products — ready for procurement, friendly for engineers.
              </h1>
              <p className="mt-4 max-w-prose text-muted-foreground">
                Buy licences for any CarrTech.dev product. Pay by card, BACS Direct Debit, or invoice.
                Every licence is a signed JWT — download it, install it on the server, and unlock
                paid features without any phone-home.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/products">
                    Browse products <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="#trust">Why teams trust us</Link>
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                What you&apos;ll install
              </div>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-4 text-xs text-foreground">
{`eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3Mi
OiJpbmZyYXdhdGNoLWxpY2Vuc2luZyIsInN1YiI6Im9y
Z19hYmNkZWZnIiwiYXVkIjoiaW5mcmF3YXRjaCIsInRp
ZXIiOiJwcm8iLCJmZWF0dXJlcyI6WyJzc29PaWRjIiwi
YXVkaXRMb2ciXSwiZXhwIjoxNzg4MDAwMDAwfQ...`}
              </pre>
              <div className="mt-4 space-y-1 text-sm text-muted-foreground">
                <div>
                  <span className="text-foreground">Signed</span> — RS256, verified locally on your server.
                </div>
                <div>
                  <span className="text-foreground">Scoped</span> — your organisation, your tier, your features.
                </div>
                <div>
                  <span className="text-foreground">Air-gap safe</span> — no outbound calls, no activation server.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
              Built for corporate procurement
            </h2>
            <p className="mb-8 max-w-prose text-muted-foreground">
              We&apos;ve thought about what your security, procurement and finance teams want to see before sign-off.
            </p>
            <TrustBadges />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Ready to buy a licence?</h2>
          <p className="mt-2 text-muted-foreground">
            Compare tiers, see exactly what&apos;s included, and check out in minutes.
          </p>
          <Button asChild size="lg" className="mt-6">
            <Link href="/products">
              Browse products <ArrowRight aria-hidden />
            </Link>
          </Button>
        </section>
      </main>

      <Footer />
    </div>
  )
}
