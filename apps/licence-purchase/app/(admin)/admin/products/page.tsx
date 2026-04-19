import Link from 'next/link'
import { asc, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { catalogSyncLog, products } from '@/lib/db/schema'
import type { SyncResult } from '@/lib/stripe/sync-catalog'
import { countTiersAndPrices } from '@/lib/catalog/queries'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ResyncButton } from './resync-button'

export const metadata = { title: 'Products' }

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export default async function AdminProductsPage() {
  const rows = await db
    .select()
    .from(products)
    .orderBy(asc(products.displayOrder), asc(products.name))

  const withCounts = await Promise.all(
    rows.map(async (p) => ({ product: p, counts: await countTiersAndPrices(p.id) })),
  )

  const [lastSync] = await db
    .select()
    .from(catalogSyncLog)
    .orderBy(desc(catalogSyncLog.createdAt))
    .limit(1)
  const lastResult = (lastSync?.result ?? null) as SyncResult | null

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Products, tiers, prices, names and features are managed in Stripe. Changes here are
            local overrides (description, display order, active state).
          </p>
        </div>
        <ResyncButton />
      </div>

      {lastSync ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Last sync</CardTitle>
            <CardDescription>
              {formatDate(lastSync.createdAt)} · trigger: {lastSync.trigger}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {lastResult ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-foreground md:grid-cols-5">
                  <div>Products: {lastResult.productsUpserted}</div>
                  <div>Tiers: {lastResult.tiersUpserted}</div>
                  <div>Prices: {lastResult.pricesUpserted}</div>
                  <div>Tiers deactivated: {lastResult.tiersDeactivated}</div>
                  <div>Prices deactivated: {lastResult.pricesDeactivated}</div>
                </div>
                {lastResult.warnings.length > 0 ? (
                  <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                    <div className="font-medium">Warnings</div>
                    <ul className="mt-1 list-disc pl-5">
                      {lastResult.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Slug</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Tiers</th>
              <th className="px-4 py-2">Active prices</th>
              <th className="px-4 py-2">Order</th>
              <th className="px-4 py-2">Active</th>
              <th className="px-4 py-2">Last synced</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {withCounts.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No products yet. Click &ldquo;Resync from Stripe&rdquo; to import.
                </td>
              </tr>
            ) : (
              withCounts.map(({ product, counts }) => (
                <tr key={product.id} className="text-foreground">
                  <td className="px-4 py-2 font-mono text-xs">{product.slug}</td>
                  <td className="px-4 py-2">{product.name}</td>
                  <td className="px-4 py-2">{counts.tierCount}</td>
                  <td className="px-4 py-2">{counts.activePriceCount}</td>
                  <td className="px-4 py-2">{product.displayOrder}</td>
                  <td className="px-4 py-2">{product.isActive ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {formatDate(product.lastSyncedAt)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/admin/products/${product.slug}`}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
