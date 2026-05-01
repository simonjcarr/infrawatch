import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DatabaseZap,
  KeyRound,
  ServerCog,
  XCircle,
} from 'lucide-react'
import { getRequiredSession } from '@/lib/auth/session'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buildCtCveConnectorSetupOverview } from '@/lib/integrations/ct-cve/setup-status'
import type { CtCveConnectorSetupOverview } from '@/lib/integrations/ct-cve/setup-status'

export const metadata: Metadata = {
  title: 'CT-CVE Integration Settings',
}

const tabs = [
  { title: 'LDAP / Directory', href: '/settings/integrations' },
  { title: 'SMTP relay', href: '/settings/integrations/smtp' },
  { title: 'CT-CVE', href: '/settings/integrations/ct-cve' },
]

function formatDateTime(value: string | null) {
  if (!value) return 'Not received'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? 'default' : 'outline'} className="gap-1">
      {ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      {label}
    </Badge>
  )
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  )
}

function EndpointRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <code className="mt-1 block overflow-x-auto whitespace-nowrap text-sm">{value}</code>
    </div>
  )
}

function ConnectorWarnings({ overview }: { overview: CtCveConnectorSetupOverview }) {
  const errors = [
    overview.inbound.error,
    overview.inventoryPush.error,
    overview.status.lastErrorCode
      ? `Last connector error: ${overview.status.lastErrorCode} at ${formatDateTime(overview.status.lastErrorAt)}`
      : null,
  ].filter((error): error is string => Boolean(error))

  if (errors.length === 0) return null

  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>Connector attention required</AlertTitle>
      <AlertDescription>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

export default async function CtCveIntegrationSettingsPage() {
  const session = await getRequiredSession()

  if (!ADMIN_ROLES.includes(session.user.role)) {
    redirect('/settings')
  }

  const orgId = session.user.organisationId!
  const overview = await buildCtCveConnectorSetupOverview({ orgId })

  return (
    <div className="space-y-6">
      <AdminTabs tabs={tabs} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">CT-CVE Connector</h1>
          <StatusBadge ok={overview.configured} label={overview.configured ? 'Configured' : 'Not configured'} />
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          CT-CVE supplies vulnerability findings while CT Ops remains the inventory and reporting surface.
        </p>
      </div>

      <ConnectorWarnings overview={overview} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-muted-foreground" />
              Inbound CT-CVE Tokens
            </CardTitle>
            <CardDescription>Signed requests from CT-CVE to CT Ops.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatRow label="Active tokens" value={overview.inbound.tokenCount} />
            <StatRow label="Revoked tokens" value={overview.inbound.revokedTokenCount} />
            <StatRow
              label="Scopes"
              value={overview.inbound.scopes.length > 0 ? overview.inbound.scopes.join(', ') : 'None'}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <DatabaseZap className="size-4 text-muted-foreground" />
              Inventory Push
            </CardTitle>
            <CardDescription>Scheduled CT Ops inventory delivery to CT-CVE.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatRow label="Configured targets" value={overview.inventoryPush.targetCount} />
            <StatRow label="Last inventory push" value={formatDateTime(overview.status.lastInventoryPushAt)} />
            <StatRow label="Last finding import" value={formatDateTime(overview.status.lastFindingIngestAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4 text-muted-foreground" />
              Connection Health
            </CardTitle>
            <CardDescription>Latest signed CT-CVE connector heartbeat.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatRow label="Last health check" value={formatDateTime(overview.status.lastHealthCheckAt)} />
            <StatRow label="Connector enabled" value={overview.status.enabled ? 'Yes' : 'No'} />
            <StatRow label="Contract version" value={overview.status.contractVersion} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ServerCog className="size-4 text-muted-foreground" />
            CT-CVE Targets
          </CardTitle>
          <CardDescription>Configured outbound inventory destinations for this organisation.</CardDescription>
        </CardHeader>
        <CardContent>
          {overview.inventoryPush.targets.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {overview.inventoryPush.targets.map((target) => (
                <div key={`${target.name}:${target.baseUrl}`} className="rounded-md border border-border p-3">
                  <div className="font-medium">{target.name}</div>
                  <div className="mt-1 overflow-x-auto whitespace-nowrap text-sm text-muted-foreground">
                    {target.baseUrl}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No CT-CVE inventory push targets are configured.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Connector Endpoints</CardTitle>
          <CardDescription>Allow these CT Ops endpoints from the CT-CVE service.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <EndpointRow label="Connection health" value="/api/integrations/ct-cve/v1/connection-health" />
          <EndpointRow label="Finding batches" value="/api/integrations/ct-cve/v1/finding-batches" />
          <EndpointRow label="Inbound tokens" value="CT_CVE_SERVICE_TOKENS" />
          <EndpointRow label="Inventory push targets" value="CT_CVE_INVENTORY_PUSH_TARGETS" />
        </CardContent>
      </Card>
    </div>
  )
}
