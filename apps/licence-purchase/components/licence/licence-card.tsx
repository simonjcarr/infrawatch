import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Licence } from '@/lib/db/schema'

function licenceStatus(licence: Licence): { label: string; variant: 'default' | 'secondary' | 'destructive' } {
  if (licence.revokedAt) return { label: 'Revoked', variant: 'destructive' }
  const now = Date.now()
  const exp = licence.expiresAt.getTime()
  if (exp < now) return { label: 'Expired', variant: 'destructive' }
  const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24))
  if (daysLeft <= 30) return { label: `Expires in ${daysLeft}d`, variant: 'secondary' }
  return { label: 'Active', variant: 'default' }
}

export function LicenceCard({ licence }: { licence: Licence }) {
  const status = licenceStatus(licence)
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base capitalize">{licence.tier}</CardTitle>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <CardDescription>
          Issued {licence.issuedAt.toLocaleDateString()} · Expires {licence.expiresAt.toLocaleDateString()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-xs text-muted-foreground">
          Licence ID: <span className="font-mono text-foreground">{licence.jti}</span>
        </div>
        <div className="mt-4 flex gap-2">
          <Button asChild size="sm">
            <Link href={`/licences/${licence.id}`}>View &amp; download</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
