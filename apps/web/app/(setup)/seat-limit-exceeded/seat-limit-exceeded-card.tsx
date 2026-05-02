'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { signOut } from '@/lib/auth/client'

export function SeatLimitExceededCard() {
  const router = useRouter()

  async function handleSignOut() {
    await signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <Card data-testid="seat-limit-card">
      <CardHeader>
        <CardTitle data-testid="seat-limit-heading">User seat limit exceeded</CardTitle>
        <CardDescription>
          This CT-Ops installation has more active users than its current licence allows.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Ask an administrator to renew seats, deactivate unused users, or assign you to an included free seat.
        </p>
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          className="w-full"
          onClick={handleSignOut}
          data-testid="seat-limit-signout"
        >
          Sign out
        </Button>
      </CardFooter>
    </Card>
  )
}
