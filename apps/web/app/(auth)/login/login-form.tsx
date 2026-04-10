'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { signIn } from '@/lib/auth/client'

const localLoginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const domainLoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})

type LocalLoginValues = z.infer<typeof localLoginSchema>
type DomainLoginValues = z.infer<typeof domainLoginSchema>

interface LoginFormProps {
  ldapLoginEnabled?: boolean
}

export function LoginForm({ ldapLoginEnabled = false }: LoginFormProps) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [loginMode, setLoginMode] = useState<'local' | 'domain'>('local')

  const localForm = useForm<LocalLoginValues>({
    resolver: zodResolver(localLoginSchema),
  })

  const domainForm = useForm<DomainLoginValues>({
    resolver: zodResolver(domainLoginSchema),
  })

  async function onLocalSubmit(values: LocalLoginValues) {
    setServerError(null)
    const result = await signIn.email({
      email: values.email,
      password: values.password,
    })

    if (result.error) {
      setServerError(result.error.message ?? 'Sign in failed. Check your credentials.')
      return
    }

    router.push('/dashboard')
  }

  async function onDomainSubmit(values: DomainLoginValues) {
    setServerError(null)
    try {
      const res = await fetch('/api/auth/ldap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: values.username,
          password: values.password,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setServerError(data.error ?? 'Domain sign in failed.')
        return
      }

      router.push('/dashboard')
    } catch {
      setServerError('An unexpected error occurred.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {loginMode === 'local'
            ? 'Enter your email and password to access your account'
            : 'Enter your domain username and password'}
        </CardDescription>
      </CardHeader>

      {/* Mode toggle (only shown when LDAP login is available) */}
      {ldapLoginEnabled && (
        <div className="px-6 pb-2">
          <div className="flex rounded-md border p-1 gap-1">
            <button
              type="button"
              className={`flex-1 px-3 py-1.5 text-sm rounded transition-colors ${
                loginMode === 'local'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => {
                setLoginMode('local')
                setServerError(null)
              }}
            >
              Local Account
            </button>
            <button
              type="button"
              className={`flex-1 px-3 py-1.5 text-sm rounded transition-colors ${
                loginMode === 'domain'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => {
                setLoginMode('domain')
                setServerError(null)
              }}
            >
              Domain Account
            </button>
          </div>
        </div>
      )}

      {loginMode === 'local' ? (
        <form onSubmit={localForm.handleSubmit(onLocalSubmit)}>
          <CardContent className="space-y-4">
            {serverError && (
              <p className="text-sm text-destructive">{serverError}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                {...localForm.register('email')}
              />
              {localForm.formState.errors.email && (
                <p className="text-xs text-destructive">{localForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...localForm.register('password')}
              />
              {localForm.formState.errors.password && (
                <p className="text-xs text-destructive">{localForm.formState.errors.password.message}</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={localForm.formState.isSubmitting}>
              {localForm.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              Don&apos;t have an account?{' '}
              <Link href="/register" className="text-foreground font-medium underline underline-offset-4">
                Create one
              </Link>
            </p>
          </CardFooter>
        </form>
      ) : (
        <form onSubmit={domainForm.handleSubmit(onDomainSubmit)}>
          <CardContent className="space-y-4">
            {serverError && (
              <p className="text-sm text-destructive">{serverError}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="domain-username">Username</Label>
              <Input
                id="domain-username"
                type="text"
                autoComplete="username"
                placeholder="jsmith"
                {...domainForm.register('username')}
              />
              {domainForm.formState.errors.username && (
                <p className="text-xs text-destructive">{domainForm.formState.errors.username.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="domain-password">Password</Label>
              <Input
                id="domain-password"
                type="password"
                autoComplete="current-password"
                {...domainForm.register('password')}
              />
              {domainForm.formState.errors.password && (
                <p className="text-xs text-destructive">{domainForm.formState.errors.password.message}</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={domainForm.formState.isSubmitting}>
              {domainForm.formState.isSubmitting ? 'Signing in...' : 'Sign in with Domain Account'}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  )
}
