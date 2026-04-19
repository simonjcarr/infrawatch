// Run via: pnpm tsx apps/licence-purchase/scripts/sync-stripe-catalog.ts
// Pulls every active Stripe product carrying `carrtech_product` metadata into
// the licence_purchase catalog tables. Safe to re-run; rows are upserted.

import { syncStripeCatalog } from '@/lib/stripe/sync-catalog'

async function main(): Promise<void> {
  const result = await syncStripeCatalog('cli')
  console.log('Stripe catalog sync complete:')
  console.log(`  productsUpserted:   ${result.productsUpserted}`)
  console.log(`  tiersUpserted:      ${result.tiersUpserted}`)
  console.log(`  pricesUpserted:     ${result.pricesUpserted}`)
  console.log(`  tiersDeactivated:   ${result.tiersDeactivated}`)
  console.log(`  pricesDeactivated:  ${result.pricesDeactivated}`)
  if (result.warnings.length > 0) {
    console.log('\nWarnings:')
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`)
    }
    process.exit(2)
  }
}

main().catch((err) => {
  console.error('Sync failed:', err)
  process.exit(1)
})
