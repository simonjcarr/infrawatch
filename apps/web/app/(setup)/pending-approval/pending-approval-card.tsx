'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { signOut } from '@/lib/auth/client'

export function PendingApprovalCard() {
  const router = useRouter()

  async function handleSignOut() {
    await signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account pending approval</CardTitle>
        <CardDescription>
          Your account has been created but needs to be approved by an administrator.
          You&apos;ll be able to access the dashboard once a role has been assigned to you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          If you believe this is an error, please contact your system administrator.
        </p>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full" onClick={handleSignOut}>
          Sign out
        </Button>
      </CardFooter>
    </Card>
  )
}
