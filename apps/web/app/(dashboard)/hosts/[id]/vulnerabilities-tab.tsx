'use client'

import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Bug, ShieldAlert, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getHostVulnerabilities } from '@/lib/actions/vulnerabilities'

interface Props {
  orgId: string
  hostId: string
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === 'critical') return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">Critical</Badge>
  if (severity === 'high') return <Badge className="bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100">High</Badge>
  if (severity === 'medium') return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">Medium</Badge>
  if (severity === 'low') return <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">Low</Badge>
  return <Badge variant="outline">Unknown</Badge>
}

export function VulnerabilitiesTab({ orgId, hostId }: Props) {
  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['host-vulnerabilities', orgId, hostId],
    queryFn: () => getHostVulnerabilities(orgId, hostId),
    staleTime: 30_000,
  })

  const critical = findings.filter((finding) => finding.severity === 'critical').length
  const exploited = findings.filter((finding) => finding.knownExploited).length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Open Findings</p>
            <p className="text-4xl font-bold tabular-nums">{findings.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Critical</p>
            <p className="text-4xl font-bold tabular-nums text-red-600">{critical}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Known Exploited</p>
            <p className="text-4xl font-bold tabular-nums text-orange-600">{exploited}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="size-4 text-muted-foreground" />
            Vulnerabilities
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading vulnerabilities…</p>
          ) : findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open Linux package CVE findings for this host.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CVE</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Installed</TableHead>
                  <TableHead>Fixed</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.map((finding) => (
                  <TableRow key={finding.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {finding.knownExploited ? <Zap className="size-4 text-orange-600" /> : <Bug className="size-4 text-muted-foreground" />}
                        <span className="font-mono text-sm">{finding.cveId}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{finding.packageName}</div>
                      <div className="text-xs text-muted-foreground">{finding.source}</div>
                    </TableCell>
                    <TableCell><SeverityBadge severity={finding.severity} /></TableCell>
                    <TableCell className="font-mono text-xs">{finding.installedVersion}</TableCell>
                    <TableCell className="font-mono text-xs">{finding.fixedVersion ?? '—'}</TableCell>
                    <TableCell>{formatDistanceToNow(new Date(finding.lastSeenAt), { addSuffix: true })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

