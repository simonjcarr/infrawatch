import Link from 'next/link'
import { Nav } from '@/components/shared/nav'
import { Footer } from '@/components/shared/footer'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { getOptionalSession } from '@/lib/auth/session'
import { listActiveProducts } from '@/lib/catalog/queries'

export const metadata = { title: 'Products' }

type Search = Promise<{ q?: string | string[] }>

export default async function ProductsIndexPage({ searchParams }: { searchParams: Search }) {
  const { q } = await searchParams
  const query = typeof q === 'string' ? q : Array.isArray(q) ? (q[0] ?? '') : ''

  const [session, items] = await Promise.all([getOptionalSession(), listActiveProducts(query)])

  return (
    <div className="flex min-h-screen flex-col">
      <Nav isAuthenticated={!!session} />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              CarrTech.dev products
            </h1>
            <p className="mx-auto mt-2 max-w-prose text-muted-foreground">
              Every CarrTech.dev product is self-hosted, air-gap friendly, and licensed with a
              signed JWT validated offline on your own infrastructure.
            </p>
          </div>

          <form
            action="/products"
            method="get"
            className="mx-auto mt-8 flex max-w-xl gap-2"
            role="search"
          >
            <Input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search products…"
              aria-label="Search products"
            />
            <Button type="submit">Search</Button>
            {query ? (
              <Button type="button" variant="outline" asChild>
                <Link href="/products">Clear</Link>
              </Button>
            ) : null}
          </form>

          {items.length === 0 ? (
            <p className="mt-12 text-center text-muted-foreground">
              {query
                ? `No products match "${query}".`
                : 'No products are available yet. Check back soon.'}
            </p>
          ) : (
            <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {items.map((product) => (
                <Card key={product.id} className="h-full">
                  <CardHeader>
                    <CardTitle className="text-lg">{product.name}</CardTitle>
                    {product.description ? (
                      <CardDescription>{product.description}</CardDescription>
                    ) : null}
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <Button asChild className="w-full">
                      <Link href={`/products/${product.slug}`}>View tiers &amp; pricing</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
