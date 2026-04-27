'use client'

import type { FormEvent } from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EMAIL_VERIFICATION_RESEND_SENT_MESSAGE } from '@/lib/auth/email-verification-resend'

type VerificationResendFormProps = {
  initialEmail?: string | null
}

export function VerificationResendForm({ initialEmail }: VerificationResendFormProps) {
  const [email, setEmail] = useState(initialEmail ?? '')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    setIsSubmitting(true)

    try {
      const res = await fetch('/api/auth/resend-verification-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          callbackURL: '/dashboard',
        }),
      })
      const data = await res.json().catch(() => null) as { message?: string } | null

      if (!res.ok) {
        setError(data?.message ?? 'Could not send a verification email. Please try again.')
        return
      }

      setMessage(data?.message ?? EMAIL_VERIFICATION_RESEND_SENT_MESSAGE)
      setPassword('')
    } catch {
      setError('Could not send a verification email. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="verification-email">Email</Label>
        <Input
          id="verification-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          data-testid="verification-email"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="verification-password">Password</Label>
        <Input
          id="verification-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          data-testid="verification-password"
          required
        />
      </div>
      <Button type="submit" disabled={isSubmitting} data-testid="resend-verification-email">
        {isSubmitting ? 'Sending...' : 'Send new verification email'}
      </Button>
      {message && (
        <p className="text-sm text-muted-foreground" data-testid="resend-verification-message">
          {message}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" data-testid="resend-verification-error">
          {error}
        </p>
      )}
    </form>
  )
}
