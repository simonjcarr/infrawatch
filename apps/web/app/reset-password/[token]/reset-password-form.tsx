'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

const resetPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(12, 'Password must be at least 12 characters')
      .max(128, 'Password must be at most 128 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>

type ResetPasswordFormProps = {
  token: string
  callbackURL: string | null
}

function getSafeCallbackUrl(callbackURL: string | null): string {
  if (!callbackURL) return '/login?reset=1'
  if (!callbackURL.startsWith('/') || callbackURL.startsWith('//')) return '/login?reset=1'
  return callbackURL
}

export function ResetPasswordForm({ token, callbackURL }: ResetPasswordFormProps) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
  })

  async function onSubmit(values: ResetPasswordValues) {
    setServerError(null)

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          newPassword: values.newPassword,
        }),
      })

      const data = (await res.json().catch(() => null)) as { message?: string } | null
      if (!res.ok) {
        setServerError(data?.message ?? 'Unable to reset your password.')
        return
      }

      router.push(getSafeCallbackUrl(callbackURL))
    } catch {
      setServerError('Unable to reset your password.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">CT-Ops</h1>
          <p className="text-sm text-muted-foreground mt-1">Choose a new password for your account</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Choose a new password</CardTitle>
            <CardDescription>
              Set a new password for your local CT-Ops account.
            </CardDescription>
          </CardHeader>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  data-testid="reset-password-new-password"
                  {...form.register('newPassword')}
                />
                {form.formState.errors.newPassword && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.newPassword.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  data-testid="reset-password-confirm-password"
                  {...form.register('confirmPassword')}
                />
                {form.formState.errors.confirmPassword && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.confirmPassword.message}
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
                data-testid="reset-password-submit"
              >
                {form.formState.isSubmitting ? 'Saving password...' : 'Save new password'}
              </Button>
              <Link href="/login" className="text-sm text-foreground underline underline-offset-4">
                Back to sign in
              </Link>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}
