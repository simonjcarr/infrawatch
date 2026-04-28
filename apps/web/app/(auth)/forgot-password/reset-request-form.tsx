'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>

export function ForgotPasswordForm() {
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
  })

  async function onSubmit(values: ForgotPasswordValues) {
    setServerError(null)
    setSuccessMessage(null)

    try {
      const res = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: values.email,
          redirectTo: '/login?reset=1',
        }),
      })

      const data = (await res.json().catch(() => null)) as { message?: string } | null
      if (!res.ok) {
        setServerError(data?.message ?? 'Unable to request a password reset right now.')
        return
      }

      void data
      setSuccessMessage('If an account exists for that email, we sent a password reset link.')
    } catch {
      setServerError('Unable to request a password reset right now.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          Enter the email address for your local CT-Ops account and we&apos;ll send you a reset link.
        </CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          {successMessage && (
            <p className="text-sm text-foreground" data-testid="forgot-password-success">
              {successMessage}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="forgot-password-email">Email</Label>
            <Input
              id="forgot-password-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              data-testid="forgot-password-email"
              {...form.register('email')}
            />
            {form.formState.errors.email && (
              <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button
            type="submit"
            className="w-full"
            disabled={form.formState.isSubmitting}
            data-testid="forgot-password-submit"
          >
            {form.formState.isSubmitting ? 'Sending reset link...' : 'Send reset link'}
          </Button>
          <Link href="/login" className="text-sm text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        </CardFooter>
      </form>
    </Card>
  )
}
