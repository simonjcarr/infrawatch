'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { ShieldCheck, ShieldAlert, ShieldX, Shield, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CertificateStatusBadge } from '@/components/certificates/certificate-status-badge'
import {
  deleteCertificate,
  type CertificateCounts,
  type CertificateListFilters,
} from '@/lib/actions/certificates'
import type { Certificate, CertificateStatus } from '@/lib/db/schema'
import { formatDaysUntil } from '@/lib/certificates/expiry'

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function SummaryCard({
  title,
  count,
  icon: Icon,
  colorClass,
  onClick,
  active,
}: {
  title: string
  count: number
  icon: React.ElementType
  colorClass: string
  onClick: () => void
  active: boolean
}) {
  return (
    <Card
      className={`cursor-pointer transition-colors ${active ? 'ring-2 ring-primary' : 'hover:bg-muted/50'}`}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon className={`size-4 ${colorClass}`} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${colorClass}`}>{count}</div>
      </CardContent>
    </Card>
  )
}

export function CertificatesClient({
  orgId,
  initialCertificates,
  initialCounts,
}: {
  orgId: string
  initialCertificates: Certificate[]
  initialCounts: CertificateCounts
}) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<CertificateStatus | 'all'>('all')
  const [hostFilter, setHostFilter] = useState('')
  const [sortBy, setSortBy] = useState<CertificateListFilters['sortBy']>('not_after')

  const filters: CertificateListFilters = {
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(hostFilter !== '' ? { host: hostFilter } : {}),
    sortBy,
    sortDir: 'asc',
    limit: 100,
  }

  const { data: certs = initialCertificates } = useQuery({
    queryKey: ['certificates', orgId, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.host ? { host: filters.host } : {}),
        sortBy: filters.sortBy ?? 'not_after',
        sortDir: filters.sortDir ?? 'asc',
        limit: String(filters.limit ?? 100),
      })
      const res = await fetch(`/api/certificates?${params}`)
      if (!res.ok) throw new Error('Failed to fetch certificates')
      return res.json() as Promise<Certificate[]>
    },
    initialData: initialCertificates,
    staleTime: 30_000,
  })

  const { data: counts = initialCounts } = useQuery({
    queryKey: ['certificate-counts', orgId],
    queryFn: async () => {
      const res = await fetch('/api/certificates/counts')
      if (!res.ok) throw new Error('Failed to fetch certificate counts')
      return res.json() as Promise<CertificateCounts>
    },
    initialData: initialCounts,
    staleTime: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (certId: string) => deleteCertificate(orgId, certId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates', orgId] })
      queryClient.invalidateQueries({ queryKey: ['certificate-counts', orgId] })
    },
  })

  const totalCerts = counts.valid + counts.expiringSoon + counts.expired + counts.invalid

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Certificates</h1>
        <p className="text-muted-foreground mt-1">
          {totalCerts} certificate{totalCerts !== 1 ? 's' : ''} tracked across your infrastructure
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          title="Valid"
          count={counts.valid}
          icon={ShieldCheck}
          colorClass="text-green-600"
          onClick={() => setStatusFilter(statusFilter === 'valid' ? 'all' : 'valid')}
          active={statusFilter === 'valid'}
        />
        <SummaryCard
          title="Expiring Soon"
          count={counts.expiringSoon}
          icon={ShieldAlert}
          colorClass="text-amber-600"
          onClick={() => setStatusFilter(statusFilter === 'expiring_soon' ? 'all' : 'expiring_soon')}
          active={statusFilter === 'expiring_soon'}
        />
        <SummaryCard
          title="Expired"
          count={counts.expired}
          icon={ShieldX}
          colorClass="text-red-600"
          onClick={() => setStatusFilter(statusFilter === 'expired' ? 'all' : 'expired')}
          active={statusFilter === 'expired'}
        />
        <SummaryCard
          title="Invalid"
          count={counts.invalid}
          icon={Shield}
          colorClass="text-destructive"
          onClick={() => setStatusFilter(statusFilter === 'invalid' ? 'all' : 'invalid')}
          active={statusFilter === 'invalid'}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Filter by host..."
            className="pl-9 w-56"
            value={hostFilter}
            onChange={(e) => setHostFilter(e.target.value)}
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as CertificateStatus | 'all')}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="valid">Valid</SelectItem>
            <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="invalid">Invalid</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(v) => setSortBy(v as CertificateListFilters['sortBy'])}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="not_after">Expiry (soonest first)</SelectItem>
            <SelectItem value="common_name">Common Name</SelectItem>
            <SelectItem value="last_seen">Last Seen</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {certs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldCheck className="size-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground font-medium">No certificates found</p>
          <p className="text-sm text-muted-foreground mt-1">
            Add a certificate check to a host to start tracking TLS certificates.
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Common Name</TableHead>
                <TableHead>Issuer</TableHead>
                <TableHead>Host:Port</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {certs.map((cert) => (
                <TableRow
                  key={cert.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/certificates/${cert.id}`)}
                >
                  <TableCell className="font-medium max-w-48 truncate">{cert.commonName}</TableCell>
                  <TableCell className="text-muted-foreground max-w-40 truncate">{cert.issuer}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-sm">
                    {cert.host}:{cert.port}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{formatDate(cert.notAfter)}</div>
                    <div className="text-xs text-muted-foreground">{formatDaysUntil(new Date(cert.notAfter))}</div>
                  </TableCell>
                  <TableCell>
                    <CertificateStatusBadge status={cert.status as CertificateStatus} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDistanceToNow(new Date(cert.lastSeenAt), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteMutation.mutate(cert.id)
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
