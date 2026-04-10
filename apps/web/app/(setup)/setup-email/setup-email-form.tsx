'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { updateEmail } from '@/lib/actions/profile'

const emailSchema = z.object({
  email: z
    .string()
    .email('Enter a valid email address')
    .refine((e) => !e.endsWith('@ldap.local'), 'Please enter a real email address'),
})

type EmailValues = z.infer<typeof emailSchema>

interface SetupEmailFormProps {
  userId: string
  username: string
}

export function SetupEmailForm({ userId, username }: SetupEmailFormProps) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
  })

  const { mutate, isPending } = useMutation({
    mutationFn: (values: EmailValues) => updateEmail(userId, values.email),
    onSuccess: (result) => {
      if ('error' in result) {
        setServerError(result.error)
        return
      }
      router.push('/dashboard')
      router.refresh()
    },
    onError: (err) => {
      setServerError(err instanceof Error ? err.message : 'An unexpected error occurred')
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set your email address</CardTitle>
        <CardDescription>
          Welcome, {username}. Your directory account does not have an email address configured.
          Please provide one to continue.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit((values) => mutate(values))}>
        <CardContent className="space-y-4">
          {serverError && (
            <p className="text-sm text-destructive">{serverError}</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...register('email')}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? 'Saving...' : 'Continue'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
