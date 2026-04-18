import { eq } from 'drizzle-orm'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ContactForm } from '@/components/account/contact-form'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { contacts, organisations, users } from '@/lib/db/schema'

export const metadata = { title: 'Account' }

// First-visit bootstrap: every authenticated user needs an organisation row
// so contacts and purchases have something to belong to. Creates a placeholder
// org named after the user; they can rename it before checkout (editor to be
// added in Phase 3 per PROGRESS.md).
async function ensureOrganisation(user: { id: string; name: string; organisationId: string | null }): Promise<string> {
  if (user.organisationId) return user.organisationId
  const [created] = await db
    .insert(organisations)
    .values({ name: `${user.name}'s organisation` })
    .returning({ id: organisations.id })
  if (!created) throw new Error('Failed to create organisation')
  await db.update(users).set({ organisationId: created.id, updatedAt: new Date() }).where(eq(users.id, user.id))
  return created.id
}

export default async function AccountPage() {
  const { user } = await getRequiredSession()
  const organisationId = await ensureOrganisation(user)

  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, organisationId) })
  const orgContacts = await db.query.contacts.findMany({ where: eq(contacts.organisationId, organisationId) })

  function findContact(role: 'technical' | 'billing' | 'procurement') {
    const c = orgContacts.find((c) => c.role === role)
    return c ? { name: c.name, email: c.email, phone: c.phone ?? '' } : undefined
  }

  return (
    <>
      <PageHeader
        title="Account"
        description="Company details and the people we should contact about billing, procurement and engineering."
      />

      <div className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Company</CardTitle>
            <CardDescription>
              {org
                ? `Registered as ${org.name}. We'll confirm and enrich these details during Stripe Checkout.`
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm md:grid-cols-2">
              <div><dt className="text-xs uppercase text-muted-foreground">Name</dt><dd className="text-foreground">{org?.name ?? '—'}</dd></div>
              <div><dt className="text-xs uppercase text-muted-foreground">Country</dt><dd className="text-foreground">{org?.country ?? '—'}</dd></div>
              <div><dt className="text-xs uppercase text-muted-foreground">VAT number</dt><dd className="text-foreground">{org?.vatNumber ?? '—'}</dd></div>
              <div><dt className="text-xs uppercase text-muted-foreground">Stripe customer</dt><dd className="font-mono text-xs text-foreground">{org?.stripeCustomerId ?? '—'}</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ContactForm
          role="technical"
          title="Technical contact"
          description="Receives 'licence ready' notifications."
          initial={findContact('technical')}
        />
        <ContactForm
          role="billing"
          title="Billing contact"
          description="Receives invoices and payment failures."
          initial={findContact('billing')}
        />
        <ContactForm
          role="procurement"
          title="Procurement contact"
          description="Receives renewal reminders and PO correspondence."
          initial={findContact('procurement')}
        />
      </div>
    </>
  )
}
