'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { signOut } from '@/lib/auth/client'
import { navigateWithFreshDocument } from '@/lib/auth/fresh-navigation'

export function PendingApprovalCard() {
  async function handleSignOut() {
    await signOut()
    navigateWithFreshDocument('/login', 'replace')
  }

  return (
    <Card data-testid="pending-approval-card">
      <CardHeader>
        <CardTitle data-testid="pending-approval-heading">Account pending approval</CardTitle>
        <CardDescription>
          Waiting for a role to be assigned.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Your account has been created. You&apos;ll be able to access CT-Ops once a Super Admin assigns a role.
        </p>
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          className="w-full"
          onClick={handleSignOut}
          data-testid="pending-approval-signout"
        >
          Sign out
        </Button>
      </CardFooter>
    </Card>
  )
}
