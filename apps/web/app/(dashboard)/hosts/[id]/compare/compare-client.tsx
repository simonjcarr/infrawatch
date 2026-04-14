'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { ArrowLeft, Loader2, GitCompare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { compareHosts } from '@/lib/actions/software-inventory'

interface Props {
  orgId: string
  hostIdA: string
  hostIdB: string
}

export function CompareHostsClient({ orgId, hostIdA, hostIdB }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['host-compare', orgId, hostIdA, hostIdB],
    queryFn: () => compareHosts(orgId, hostIdA, hostIdB),
    enabled: !!hostIdB,
  })

  if (!hostIdB) {
    return (
      <div className="max-w-2xl space-y-4">
        <Link
          href={`/hosts/${hostIdA}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to host
        </Link>
        <p className="text-sm text-muted-foreground">
          No host to compare with. Navigate here from the Inventory tab on a host page and select a
          comparison target.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link
          href={`/hosts/${hostIdA}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Link>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <GitCompare className="size-5" />
          Package comparison
        </h1>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Comparing…</span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">Failed to load comparison data.</p>}

      {data && (
        <div className="space-y-6">
          {data.differentVersion.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                Different versions
                <Badge variant="secondary">{data.differentVersion.length}</Badge>
              </h2>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Package</TableHead>
                      <TableHead>Host A</TableHead>
                      <TableHead>Host B</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.differentVersion.map((row) => (
                      <TableRow key={row.name}>
                        <TableCell className="font-mono text-sm">{row.name}</TableCell>
                        <TableCell className="font-mono text-sm text-amber-700">
                          {row.versionA}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-blue-700">
                          {row.versionB}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {data.onlyInA.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                Only in host A
                <Badge variant="secondary">{data.onlyInA.length}</Badge>
              </h2>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Package</TableHead>
                      <TableHead>Version</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.onlyInA.map((pkg) => (
                      <TableRow key={pkg.id}>
                        <TableCell className="font-mono text-sm">{pkg.name}</TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {pkg.version}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {data.onlyInB.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                Only in host B
                <Badge variant="secondary">{data.onlyInB.length}</Badge>
              </h2>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Package</TableHead>
                      <TableHead>Version</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.onlyInB.map((pkg) => (
                      <TableRow key={pkg.id}>
                        <TableCell className="font-mono text-sm">{pkg.name}</TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {pkg.version}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {data.differentVersion.length === 0 &&
            data.onlyInA.length === 0 &&
            data.onlyInB.length === 0 && (
              <div className="text-center py-12 text-sm text-muted-foreground">
                These hosts have identical package sets.
              </div>
            )}
        </div>
      )}
    </div>
  )
}
