'use client'

import { hasFeature, type Feature, type LicenceTier } from '@/lib/features'

interface FeatureGateProps {
  feature: Feature
  tier: LicenceTier
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function FeatureGate({ feature, tier, children, fallback }: FeatureGateProps) {
  if (hasFeature(tier, feature)) {
    return <>{children}</>
  }

  if (fallback) return <>{fallback}</>

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
      <p className="font-medium text-foreground mb-1">Upgrade required</p>
      <p className="text-muted-foreground">This feature requires a higher licence tier.</p>
    </div>
  )
}
