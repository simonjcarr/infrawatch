import { notFound } from 'next/navigation'
import { Nav } from '@/components/shared/nav'
import { Footer } from '@/components/shared/footer'
import { getOptionalSession } from '@/lib/auth/session'
import { getActiveProductBySlug, listTiersForProduct } from '@/lib/catalog/queries'
import { ProductDetail } from './product-detail'

type Params = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params
  const product = await getActiveProductBySlug(slug)
  return { title: product ? product.name : 'Product' }
}

export default async function ProductDetailPage({ params }: { params: Params }) {
  const { slug } = await params

  const product = await getActiveProductBySlug(slug)
  if (!product) notFound()

  const [session, tiers] = await Promise.all([
    getOptionalSession(),
    listTiersForProduct(product.id, { activeOnly: true }),
  ])

  return (
    <div className="flex min-h-screen flex-col">
      <Nav isAuthenticated={!!session} />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {product.name}
            </h1>
            {product.description ? (
              <p className="mx-auto mt-2 max-w-prose text-muted-foreground">
                {product.description}
              </p>
            ) : null}
          </div>

          <ProductDetail productSlug={product.slug} tiers={tiers} />

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Prices exclude VAT. Annual plans are billed in one upfront payment.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
