'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export function LogoutButton() {
  const router = useRouter()
  const [pending, start] = useTransition()

  function onClick() {
    start(async () => {
      await fetch('/api/auth/sign-out', { method: 'POST' })
      router.push('/login')
      router.refresh()
    })
  }

  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
