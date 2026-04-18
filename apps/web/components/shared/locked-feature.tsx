import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Feature, LicenceTier } from '@/lib/features'

const FEATURE_COPY: Record<Feature, { title: string; description: string; requiredTier: LicenceTier }> = {
  ssoOidc: {
    title: 'OIDC Single Sign-On',
    description: 'Connect Google, Entra, Okta, or Keycloak for organisation-wide sign-in.',
    requiredTier: 'pro',
  },
  auditLog: {
    title: 'Audit Log',
    description: 'Full audit trail of user and admin actions with export and retention controls.',
    requiredTier: 'pro',
  },
  certExpiryTracker: {
    title: 'Certificate Expiry Tracker',
    description: 'Dashboards, scheduled expiry notifications, and bulk export for every tracked certificate.',
    requiredTier: 'pro',
  },
  serviceAccountTracker: {
    title: 'Service Account Tracker',
    description: 'Track service account password and token expiry across hosts and directories.',
    requiredTier: 'pro',
  },
  reportsExport: {
    title: 'Reports',
    description: 'Generate, save, and export inventory reports as CSV or PDF.',
    requiredTier: 'pro',
  },
  reportsScheduled: {
    title: 'Scheduled Reports',
    description: 'Deliver reports on a schedule to email or webhook destinations.',
    requiredTier: 'pro',
  },
  metricRetentionExtended: {
    title: 'Extended Metric Retention',
    description: 'Retain metrics for up to 365 days and export via the metric API.',
    requiredTier: 'pro',
  },
  scheduledTasks: {
    title: 'Scheduled Task Runner',
    description: 'Run custom scripts on a schedule across host groups.',
    requiredTier: 'pro',
  },
  alertRouting: {
    title: 'Alert Routing Policies',
    description: 'On-call rotations, escalation policies, and advanced routing.',
    requiredTier: 'pro',
  },
  csrInternalCa: {
    title: 'CSR & Internal CA',
    description: 'Generate CSRs, run an approval workflow, and issue certificates from an internal CA.',
    requiredTier: 'pro',
  },
  sshKeyInventory: {
    title: 'SSH Key Inventory',
    description: 'Track SSH keys and rotation across every host.',
    requiredTier: 'pro',
  },
  ssoSaml: {
    title: 'SAML 2.0 SSO',
    description: 'Enterprise identity provider integration via SAML 2.0.',
    requiredTier: 'enterprise',
  },
  advancedRbac: {
    title: 'Advanced RBAC',
    description: 'Tag-based resource scoping and custom role definitions.',
    requiredTier: 'enterprise',
  },
  whiteLabel: {
    title: 'White Labelling',
    description: 'Custom logo, theme, login page, and email sender.',
    requiredTier: 'enterprise',
  },
  compliancePack: {
    title: 'Compliance Packs',
    description: 'SOC 2, ISO 27001, and HIPAA-style evidence templates.',
    requiredTier: 'enterprise',
  },
  airgapBundlers: {
    title: 'Air-gap Bundlers',
    description: 'Bundlers for Jenkins, Docker, Ansible, and Terraform.',
    requiredTier: 'enterprise',
  },
  haDeployment: {
    title: 'HA Deployment',
    description: 'High-availability deployment profile and migration tooling.',
    requiredTier: 'enterprise',
  },
}

const TIER_LABEL: Record<LicenceTier, string> = {
  community: 'Community',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

export function LockedFeature({ feature, tier }: { feature: Feature; tier: LicenceTier }) {
  const copy = FEATURE_COPY[feature]
  return (
    <div className="mx-auto max-w-xl py-12">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Lock className="size-5" />
            </div>
            <div className="flex-1">
              <CardTitle>{copy.title}</CardTitle>
              <CardDescription>Upgrade required to access this feature</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{copy.description}</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Your plan:</span>
            <Badge variant="outline">{TIER_LABEL[tier]}</Badge>
            <span className="text-muted-foreground">Required:</span>
            <Badge>{TIER_LABEL[copy.requiredTier]}</Badge>
          </div>
          <div className="pt-2">
            <Button asChild>
              <Link href="/settings">Manage licence</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
