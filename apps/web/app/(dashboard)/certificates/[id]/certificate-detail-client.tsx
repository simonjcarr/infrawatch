'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowLeft, Copy, Check, Clock } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CertificateStatusBadge } from '@/components/certificates/certificate-status-badge'
import { getCertificate } from '@/lib/actions/certificates'
import type { Certificate, CertificateEvent, CertificateEventType, CertificateStatus } from '@/lib/db/schema'
import { formatDaysUntil } from '@/lib/certificates/expiry'

function formatDate(date: Date | string): string {
  return format(new Date(date), 'MMM d, yyyy HH:mm')
}

function EventTypeBadge({ type }: { type: CertificateEventType }) {
  const configs: Record<CertificateEventType, { label: string; className: string }> = {
    discovered: { label: 'Discovered', className: 'bg-blue-100 text-blue-800 border-blue-200' },
    renewed: { label: 'Renewed', className: 'bg-green-100 text-green-800 border-green-200' },
    expiring_soon: { label: 'Expiring Soon', className: 'bg-amber-100 text-amber-800 border-amber-200' },
    expired: { label: 'Expired', className: 'bg-red-100 text-red-800 border-red-200' },
    restored: { label: 'Restored', className: 'bg-green-100 text-green-800 border-green-200' },
    removed: { label: 'Removed', className: 'bg-gray-100 text-gray-700 border-gray-200' },
  }
  const cfg = configs[type] ?? { label: type, className: 'bg-gray-100 text-gray-700 border-gray-200' }
  return <Badge className={`${cfg.className} hover:${cfg.className}`}>{cfg.label}</Badge>
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="ghost" size="icon" className="size-7 ml-1" onClick={handleCopy}>
      {copied ? (
        <Check className="size-3.5 text-green-600" />
      ) : (
        <Copy className="size-3.5 text-muted-foreground" />
      )}
    </Button>
  )
}

interface Props {
  orgId: string
  initialCertificate: Certificate
  initialEvents: CertificateEvent[]
}

export function CertificateDetailClient({ orgId, initialCertificate, initialEvents }: Props) {
  const { data } = useQuery({
    queryKey: ['certificate', orgId, initialCertificate.id],
    queryFn: () => getCertificate(orgId, initialCertificate.id),
    initialData: { certificate: initialCertificate, events: initialEvents },
  })

  const cert = data?.certificate ?? initialCertificate
  const events = data?.events ?? initialEvents

  const details = cert.details as import('@/lib/db/schema').CertificateDetails | null
  const sans = cert.sans as string[]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/certificates">
          <Button variant="ghost" size="icon" className="mt-0.5">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-foreground truncate">{cert.commonName}</h1>
            <CertificateStatusBadge status={cert.status as CertificateStatus} />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {cert.host}:{cert.port}
            {cert.serverName !== cert.host ? ` (SNI: ${cert.serverName})` : ''}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Expires</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{formatDate(cert.notAfter)}</div>
            <div className="text-sm text-muted-foreground">{formatDaysUntil(new Date(cert.notAfter))}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Valid From</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{formatDate(cert.notBefore)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Issuer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold truncate">{cert.issuer}</div>
          </CardContent>
        </Card>
      </div>

      {/* Fingerprint */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fingerprint (SHA-256)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1">
            <code className="text-sm font-mono break-all text-foreground">{cert.fingerprintSha256}</code>
            <CopyButton value={cert.fingerprintSha256} />
          </div>
        </CardContent>
      </Card>

      {/* SANs */}
      {sans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subject Alternative Names</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {sans.map((san) => (
                <Badge key={san} variant="secondary" className="font-mono text-xs">
                  {san}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Certificate details */}
      {details && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Certificate Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <span className="text-muted-foreground font-medium">Subject</span>
              <span className="font-mono break-all">{details.subject}</span>
              <span className="text-muted-foreground font-medium">Serial Number</span>
              <span className="font-mono break-all">{details.serialNumber}</span>
              <span className="text-muted-foreground font-medium">Signature Algorithm</span>
              <span>{details.signatureAlgorithm}</span>
              <span className="text-muted-foreground font-medium">Key Algorithm</span>
              <span>{details.keyAlgorithm}</span>
              <span className="text-muted-foreground font-medium">Self-Signed</span>
              <span>{details.isSelfSigned ? 'Yes' : 'No'}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chain */}
      {details && details.chain.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Certificate Chain</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Issuer</TableHead>
                    <TableHead>Valid Until</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {details.chain.map((entry, i) => (
                    <TableRow key={entry.fingerprintSha256}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs max-w-52 truncate">{entry.subject}</TableCell>
                      <TableCell className="font-mono text-xs max-w-52 truncate">{entry.issuer}</TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(entry.notAfter), 'MMM d, yyyy')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Event timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded.</p>
          ) : (
            <div className="space-y-3">
              {events.map((ev) => (
                <div key={ev.id} className="flex items-start gap-3">
                  <Clock className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <EventTypeBadge type={ev.eventType as CertificateEventType} />
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(ev.occurredAt), 'MMM d, yyyy HH:mm')}
                      </span>
                    </div>
                    <p className="text-sm text-foreground mt-0.5">{ev.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
