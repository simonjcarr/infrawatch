# Multi-product storefront

The licence-purchase app (`apps/licence-purchase`) is a multi-product storefront
for CarrTech.dev. CT-Ops (Infrawatch) is the first product, but the catalog is
generic — any number of products with their own tiers and prices can be sold
through the same checkout, webhook and licence-issuance pipeline.

## Public pages

| Route | Purpose |
| --- | --- |
| `/products` | Searchable product index. Uses Postgres `tsvector` full-text search over product name + description. |
| `/products/[slug]` | Product detail page with tier cards, month/year toggle, CTA to checkout. |
| `/checkout/[productSlug]/[tierSlug]` | Per-tier checkout with activation-token paste. |
| `/pricing` | Permanent redirect to `/products/ct-ops` for legacy inbound links. |

## Catalog model

Stripe is the source of truth for products, tiers, prices and features. The app
database is a queryable cache of that catalog.

```
product            parent CarrTech.dev product (slug: ct-ops, ct-insights, …)
  └─ product_tier  one per Stripe Product (tier inside the product)
       └─ product_tier_price  one per Stripe Price (month | year)
```

Each purchase and licence row carries nullable FKs to `product`, `product_tier`
and `product_tier_price` so historical rows keep resolving even after a Stripe
product is deactivated. The denormalised `tier` and `interval` text columns are
retained as a snapshot at purchase time.

## Stripe metadata

Every Stripe Product that should appear in the storefront **must** carry these
metadata keys:

| Key | Example | Notes |
| --- | --- | --- |
| `carrtech_product` | `ct-ops` | Slug of the parent product. Groups tiers together. |
| `carrtech_product_name` | `CT-Ops` | Human-readable product name (optional, falls back to slug). |
| `tier` | `pro` | Tier slug within the product. Unique per product. |
| `tier_order` | `1` | Integer ordering for the tier within the product. |
| `features` | `["ssoOidc","auditLog"]` | JSON array of feature keys unlocked at this tier. |

Each Stripe Product has two recurring prices — one monthly, one yearly — both in
the same currency.

## Sync

Catalog sync lives in [`lib/stripe/sync-catalog.ts`](https://github.com/carrtech-dev/infrawatch/tree/main/apps/licence-purchase/lib/stripe/sync-catalog.ts).

- **Full sync** — run `pnpm tsx apps/licence-purchase/scripts/sync-stripe-catalog.ts`
  or click **Resync from Stripe** in the admin UI. Paginates all active Stripe
  products, upserts each `carrtech_product`-tagged product/tier/prices, and
  deactivates any tier or price that Stripe no longer reports as active.
- **Webhook-driven sync** — `product.created | product.updated | product.deleted`
  re-syncs a single product. `price.created | price.updated | price.deleted`
  re-syncs all prices for that product.
- **Admin-owned fields** — sync never overwrites `product.description`,
  `product.displayOrder`, `product.isActive`, or `product_tier.isActive`. These
  are local-only overrides managed via the admin UI.
- **Rows are never deleted.** A removed Stripe product flips tier/price rows to
  `isActive = false`, preserving historical purchase/licence FKs.

## Checkout + licence issuance

Checkout resolves `(productSlug, tierSlug, interval)` via a DB join — a failed
join or an inactive row returns "this plan is no longer available". A tier with
zero features is blocked at checkout to prevent minting an unusable licence.

The Stripe Checkout session carries these metadata fields so the webhook can
rebuild the full catalog picture: `carrtechProductSlug`, `carrtechProductId`,
`productTierId`, `productTierPriceId`, `tierSlug`, plus `tier` and `interval` for
backward compatibility.

Licence JWTs now carry both `tier` and `product_slug` claims. Features are read
from `product_tier.features` at issue time, so the next renewal picks up any
feature changes without affecting in-flight licences.

## Admin UI

Admin routes live under `/admin/products` and are gated on
`session.user.role === 'super_admin'`. See
[`lib/auth/require-super-admin.ts`](https://github.com/carrtech-dev/infrawatch/tree/main/apps/licence-purchase/lib/auth/require-super-admin.ts).

The admin UI is read-mostly:

- Trigger a full Stripe resync.
- Edit a product's `description`, `displayOrder`, and storefront visibility.
- Toggle a tier or price off to hide it from `/products` and block new checkouts.

Products, tiers, prices, names and features themselves are managed in the Stripe
Dashboard. The admin UI surfaces what Stripe says; the sync pulls it in.

## Rollout checklist

1. Apply migrations (`pnpm run db:migrate` in `apps/licence-purchase`).
2. In the Stripe Dashboard, annotate each live product with the metadata keys
   listed above.
3. Run `pnpm tsx apps/licence-purchase/scripts/sync-stripe-catalog.ts` — expect
   zero warnings.
4. Run `pnpm tsx apps/licence-purchase/scripts/backfill-ct-ops.ts` to populate
   the new FKs on existing CT-Ops purchases and licences.
5. Flip the role of the initial super-admin user in SQL:
   `UPDATE "user" SET role = 'super_admin' WHERE email = 'you@example.com';`
