import type { Metadata } from 'next'
import Link from 'next/link'
import { FolderSearch } from 'lucide-react'
import { getRequiredSession } from '@/lib/auth/session'
import { getLookupConfigOptions } from '@/lib/actions/ldap'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DirectoryLookupClient } from './directory-lookup-client'

export const metadata: Metadata = {
  title: 'Directory User Lookup',
}

export default async function DirectoryLookupPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!
  const configs = await getLookupConfigOptions(orgId)

  if (configs.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Directory User Lookup</h1>
          <p className="text-muted-foreground mt-1">
            Search for a user in your connected LDAP or Active Directory.
          </p>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <FolderSearch className="size-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-foreground font-medium">No directory configured</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Add an LDAP or Active Directory configuration to enable directory lookups.
            </p>
            <Button asChild size="sm">
              <Link href="/settings/ldap">Configure LDAP</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <DirectoryLookupClient orgId={orgId} configs={configs} />
}
