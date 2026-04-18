import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/licence/copy-button'
import { DownloadButton } from '@/components/licence/download-button'
import { getLicenceById } from '@/lib/actions/licences'

export const metadata = { title: 'Licence detail' }

function daysUntil(target: Date): number {
  return Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export default async function LicencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const licence = await getLicenceById(id)
  if (!licence) notFound()

  const daysLeft = daysUntil(licence.expiresAt)

  return (
    <>
      <PageHeader
        title="Licence detail"
        description="Download the signed JWT and install it on your Infrawatch server."
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="capitalize">{licence.tier} tier</CardTitle>
            <Badge variant={licence.revokedAt ? 'destructive' : 'default'}>
              {licence.revokedAt ? 'Revoked' : `${daysLeft}d until expiry`}
            </Badge>
          </div>
          <CardDescription>
            Licence ID <span className="font-mono">{licence.jti}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Licence key
              </span>
              <div className="flex gap-2">
                <CopyButton value={licence.signedJwt} />
                <DownloadButton licenceId={licence.id} />
              </div>
            </div>
            <pre className="overflow-x-auto text-xs text-foreground whitespace-pre-wrap break-all">
              {licence.signedJwt}
            </pre>
          </div>

          <div className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Issued</div>
              <div className="text-foreground">{licence.issuedAt.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Expires</div>
              <div className="text-foreground">{licence.expiresAt.toLocaleString()}</div>
            </div>
            {licence.maxHosts ? (
              <div>
                <div className="text-xs uppercase text-muted-foreground">Host cap</div>
                <div className="text-foreground">{licence.maxHosts}</div>
              </div>
            ) : null}
            <div>
              <div className="text-xs uppercase text-muted-foreground">Features</div>
              <div className="text-foreground">{licence.features.length} unlocked</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
