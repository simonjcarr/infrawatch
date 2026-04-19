import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'
import type { BillingInterval, TierDefinition } from '@/lib/tiers'
import { cn } from '@/lib/utils'

export function TierCard({
  tier,
  interval,
}: {
  tier: TierDefinition
  interval: BillingInterval
}) {
  const price = tier.displayPrice[interval]
  const perMonth = price !== null && price > 0

  return (
    <Card
      className={cn(
        'h-full',
        tier.highlighted && 'ring-2 ring-primary/60',
      )}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{tier.name}</CardTitle>
          {tier.highlighted ? <Badge>Most popular</Badge> : null}
        </div>
        <CardDescription>{tier.tagline}</CardDescription>
      </CardHeader>
      <CardContent className="flex h-full flex-col gap-6">
        <div>
          {price === 0 ? (
            <div className="text-3xl font-semibold tracking-tight text-foreground">Free</div>
          ) : price !== null ? (
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight text-foreground">£{price}</span>
                <span className="text-sm text-muted-foreground">
                  {perMonth ? '/ month' : ''}
                </span>
              </div>
              {interval === 'year' ? (
                <p className="mt-1 text-xs text-muted-foreground">Billed annually</p>
              ) : null}
            </div>
          ) : (
            <div className="text-xl font-medium text-foreground">Contact us</div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{tier.audience}</p>
        </div>

        <Button
          asChild
          variant={tier.highlighted ? 'default' : 'outline'}
          className="w-full"
        >
          <Link href={`${tier.ctaHref}${tier.id !== 'community' ? `?interval=${interval}` : ''}`}>
            {tier.ctaLabel}
          </Link>
        </Button>

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {tier.featureHeader}
          </div>
          <ul className="space-y-2 text-sm">
            {tier.features.map((f) => (
              <li key={f} className="flex gap-2 text-foreground">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
