'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft,
  Hash,
  Home,
  Terminal,
  Server,
  CheckCircle,
  XCircle,
  Copy,
  Key,
} from 'lucide-react'
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
import { AccountTypeBadge } from '@/components/service-accounts/account-type-badge'
import { AccountStatusBadge } from '@/components/service-accounts/account-status-badge'
import { SshKeyTypeBadge } from '@/components/service-accounts/ssh-key-type-badge'
import type {
  ServiceAccount,
  SshKey,
  IdentityEvent,
  Host,
  ServiceAccountType,
  ServiceAccountStatus,
  SshKeyType,
  IdentityEventType,
} from '@/lib/db/schema'

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatAge(seconds: number | null): string {
  if (seconds == null) return '-'
  const days = Math.floor(seconds / 86400)
  if (days > 365) return `${Math.floor(days / 365)}y ${days % 365}d`
  if (days > 0) return `${days}d`
  const hours = Math.floor(seconds / 3600)
  if (hours > 0) return `${hours}h`
  return '<1h'
}

function CopyButton({ text }: { text: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      onClick={() => navigator.clipboard.writeText(text)}
    >
      <Copy className="size-3" />
    </Button>
  )
}

function EventTypeBadge({ eventType }: { eventType: IdentityEventType }) {
  switch (eventType) {
    case 'account_discovered':
    case 'key_discovered':
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
          Discovered
        </Badge>
      )
    case 'account_changed':
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
          Changed
        </Badge>
      )
    case 'account_missing':
    case 'key_missing':
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
          Missing
        </Badge>
      )
    case 'account_restored':
    case 'key_restored':
      return (
        <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">
          Restored
        </Badge>
      )
    default:
      return <Badge variant="outline">{eventType}</Badge>
  }
}

function InfoCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | React.ReactNode
  icon: React.ElementType
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon className="size-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-lg font-semibold">{value}</div>
      </CardContent>
    </Card>
  )
}

export function LocalUserDetailClient({
  orgId: _orgId,
  hostId,
  account,
  keys,
  events,
  host,
}: {
  orgId: string
  hostId: string
  account: ServiceAccount
  keys: SshKey[]
  events: IdentityEvent[]
  host: Host | null
}) {
  const activeKeys = keys.filter((k) => k.status === 'active')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/hosts/${hostId}`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground font-mono">
              {account.username}
            </h1>
            <AccountTypeBadge type={account.accountType as ServiceAccountType} />
            <AccountStatusBadge status={account.status as ServiceAccountStatus} />
          </div>
          <p className="text-muted-foreground mt-1">
            UID {account.uid} on{' '}
            {host ? (
              <Link href={`/hosts/${host.id}`} className="text-primary hover:underline">
                {host.hostname}
              </Link>
            ) : (
              account.hostId
            )}
          </p>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoCard label="UID / GID" value={`${account.uid} / ${account.gid}`} icon={Hash} />
        <InfoCard label="Home Directory" value={account.homeDirectory ?? '-'} icon={Home} />
        <InfoCard label="Shell" value={account.shell ?? '-'} icon={Terminal} />
        <InfoCard
          label="Host"
          value={
            host ? (
              <Link href={`/hosts/${host.id}`} className="text-primary hover:underline">
                {host.hostname}
              </Link>
            ) : (
              '-'
            )
          }
          icon={Server}
        />
      </div>

      {/* Properties */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Properties</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Login Capability</span>
              <div className="flex items-center gap-1.5 mt-1 font-medium">
                {account.hasLoginCapability ? (
                  <>
                    <CheckCircle className="size-4 text-green-600" />
                    Yes
                  </>
                ) : (
                  <>
                    <XCircle className="size-4 text-gray-500" />
                    No
                  </>
                )}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Running Processes</span>
              <div className="flex items-center gap-1.5 mt-1 font-medium">
                {account.hasRunningProcesses ? (
                  <>
                    <CheckCircle className="size-4 text-green-600" />
                    Yes
                  </>
                ) : (
                  <>
                    <XCircle className="size-4 text-gray-500" />
                    No
                  </>
                )}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">First Seen</span>
              <div className="mt-1 font-medium">{formatDate(account.firstSeenAt)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Last Seen</span>
              <div className="mt-1 font-medium">
                {formatDistanceToNow(new Date(account.lastSeenAt), { addSuffix: true })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SSH Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="size-4" />
            SSH Keys ({activeKeys.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No SSH keys discovered for this account.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Fingerprint</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell>
                        <SshKeyTypeBadge type={key.keyType as SshKeyType} />
                        {key.bitLength ? (
                          <span className="text-xs text-muted-foreground ml-1">{key.bitLength}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded max-w-48 truncate">
                            {key.fingerprintSha256}
                          </code>
                          <CopyButton text={key.fingerprintSha256} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {key.keySource === 'authorized_keys' ? 'authorized' : 'identity'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs max-w-48 truncate">
                        {key.filePath}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatAge(key.keyAgeSeconds)}
                      </TableCell>
                      <TableCell>
                        {key.status === 'active' ? (
                          <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
                            Active
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
                            Missing
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No events recorded yet.
            </p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-3 text-sm border-b last:border-b-0 pb-3 last:pb-0"
                >
                  <EventTypeBadge eventType={event.eventType as IdentityEventType} />
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground">{event.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(event.occurredAt)}
                    </p>
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
