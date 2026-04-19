import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { products } from '@/lib/db/schema'
import { listTiersForProduct } from '@/lib/catalog/queries'
import { formatPrice } from '@/lib/billing'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ProductEditForm } from './product-edit-form'
import { ToggleRow } from './toggle-row'

type Params = Promise<{ slug: string }>

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export default async function AdminProductDetailPage({ params }: { params: Params }) {
  const { slug } = await params
  const product = await db.query.products.findFirst({ where: eq(products.slug, slug) })
  if (!product) notFound()

  const tiers = await listTiersForProduct(product.id, { activeOnly: false })

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/admin/products" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to products
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        {product.name}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Products, tiers, prices, names and features are managed in Stripe. Changes here are local
        overrides.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Local overrides</CardTitle>
          <CardDescription>Description, display order, active state.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProductEditForm
            productId={product.id}
            initialDescription={product.description ?? ''}
            initialDisplayOrder={product.displayOrder}
            initialIsActive={product.isActive}
          />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Read-only</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-foreground md:grid-cols-2">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Slug</div>
            <div className="font-mono text-xs">{product.slug}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Stripe metadata name</div>
            <div>{product.stripeMetadataName ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Last synced</div>
            <div>{formatDate(product.lastSyncedAt)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Created</div>
            <div>{formatDate(product.createdAt)}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Tiers</CardTitle>
          <CardDescription>Toggle a tier off to hide it from the storefront.</CardDescription>
        </CardHeader>
        <CardContent>
          {tiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tiers synced yet.</p>
          ) : (
            <div className="space-y-4">
              {tiers.map((tier) => (
                <div key={tier.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-foreground">{tier.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Slug: <span className="font-mono">{tier.tierSlug}</span> · Order:{' '}
                        {tier.tierOrder} · Stripe product: {tier.stripeProductId}
                      </div>
                      {tier.features.length > 0 ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {tier.features.length} feature{tier.features.length === 1 ? '' : 's'}:{' '}
                          {tier.features.join(', ')}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-destructive">
                          No features — checkout is blocked for this tier.
                        </div>
                      )}
                    </div>
                    <ToggleRow kind="tier" id={tier.id} isActive={tier.isActive} />
                  </div>

                  <div className="mt-3 overflow-hidden rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-left uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5">Interval</th>
                          <th className="px-3 py-1.5">Amount</th>
                          <th className="px-3 py-1.5">Stripe price</th>
                          <th className="px-3 py-1.5">Active</th>
                          <th className="px-3 py-1.5 text-right" />
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {tier.prices.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-2 text-muted-foreground">
                              No prices synced.
                            </td>
                          </tr>
                        ) : (
                          tier.prices.map((price) => (
                            <tr key={price.id}>
                              <td className="px-3 py-1.5">{price.interval}</td>
                              <td className="px-3 py-1.5">
                                {formatPrice(price.unitAmount, price.currency)}
                              </td>
                              <td className="px-3 py-1.5 font-mono">{price.stripePriceId}</td>
                              <td className="px-3 py-1.5">{price.isActive ? 'Yes' : 'No'}</td>
                              <td className="px-3 py-1.5 text-right">
                                <ToggleRow
                                  kind="price"
                                  id={price.id}
                                  isActive={price.isActive}
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
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
