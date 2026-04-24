import type { Metadata } from 'next'
import { BundlersClient } from './bundlers-client'

export const metadata: Metadata = {
  title: 'Air-gap Bundlers',
}

export default function BundlersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Air-gap Bundlers</h1>
        <p className="text-muted-foreground">
          Build self-contained bundles of upstream software for installation into air-gapped networks.
        </p>
      </div>
      <BundlersClient />
    </div>
  )
}
