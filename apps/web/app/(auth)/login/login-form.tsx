'use client'

import { useState, type FormEvent } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { authClient, signIn } from '@/lib/auth/client'
import {
  getInviteAcceptPath,
  getInviteRegisterPath,
} from '@/lib/auth/invite-redirects'

const localLoginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const domainLoginSchema = z.object({
  organisationSlug: z.string().trim().min(2, 'Organisation slug is required').regex(/^[a-z0-9-]+$/, {
    message: 'Use lowercase letters, numbers, and hyphens',
  }),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})

type LocalLoginValues = z.infer<typeof localLoginSchema>
type DomainLoginValues = z.infer<typeof domainLoginSchema>
type DomainTwoFactorMethod = 'totp' | 'backup_code'
type LocalTwoFactorMethod = 'totp' | 'backup_code'

type TwoFactorRedirectData = {
  twoFactorRedirect: true
  twoFactorMethods?: string[]
}

interface LoginFormProps {
  ldapLoginEnabled?: boolean
  inviteToken?: string | null
  notice?: string | null
}

function isEmailNotVerifiedError(message: string, code?: string): boolean {
  return code === 'EMAIL_NOT_VERIFIED' || message.toLowerCase().includes('email not verified')
}

function isTwoFactorRedirectData(data: unknown): data is TwoFactorRedirectData {
  if (!data || typeof data !== 'object') return false
  return (data as { twoFactorRedirect?: unknown }).twoFactorRedirect === true
}

function cleanTwoFactorCode(code: string, method: LocalTwoFactorMethod): string {
  return method === 'totp' ? code.replace(/\s+/g, '') : code.trim()
}

export function LoginForm({ ldapLoginEnabled = false, inviteToken = null, notice = null }: LoginFormProps) {
  const router = useRouter()
  const inviteAcceptPath = getInviteAcceptPath(inviteToken)
  const [serverError, setServerError] = useState<string | null>(null)
  const [canResendVerification, setCanResendVerification] = useState(false)
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null)
  const [loginMode, setLoginMode] = useState<'local' | 'domain'>('local')
  const [localTwoFactorRequired, setLocalTwoFactorRequired] = useState(false)
  const [localTwoFactorMethods, setLocalTwoFactorMethods] = useState<LocalTwoFactorMethod[]>(['totp'])
  const [localTwoFactorMethod, setLocalTwoFactorMethod] = useState<LocalTwoFactorMethod>('totp')
  const [localTwoFactorCode, setLocalTwoFactorCode] = useState('')
  const [localTwoFactorSubmitting, setLocalTwoFactorSubmitting] = useState(false)
  const [ldapTwoFactorRequired, setLdapTwoFactorRequired] = useState(false)
  const [ldapTwoFactorCode, setLdapTwoFactorCode] = useState('')
  const [ldapTwoFactorMethod, setLdapTwoFactorMethod] = useState<DomainTwoFactorMethod>('totp')

  const localForm = useForm<LocalLoginValues>({
    resolver: zodResolver(localLoginSchema),
  })

  const domainForm = useForm<DomainLoginValues>({
    resolver: zodResolver(domainLoginSchema),
  })

  async function onLocalSubmit(values: LocalLoginValues) {
    setServerError(null)
    setCanResendVerification(false)
    setVerificationEmail(null)
    setLocalTwoFactorCode('')
    const result = await signIn.email({
      email: values.email,
      password: values.password,
    })

    if (result.error) {
      const message = result.error.message ?? 'Sign in failed. Check your credentials.'
      const isUnverifiedEmail = isEmailNotVerifiedError(message, result.error.code)
      setServerError(message)
      setCanResendVerification(isUnverifiedEmail)
      setVerificationEmail(isUnverifiedEmail ? values.email : null)
      return
    }

    if (isTwoFactorRedirectData(result.data)) {
      const methods = result.data.twoFactorMethods?.filter(
        (method): method is LocalTwoFactorMethod => method === 'totp' || method === 'backup_code',
      )
      const availableMethods: LocalTwoFactorMethod[] = methods && methods.length > 0 ? methods : ['totp']
      setLocalTwoFactorMethods(availableMethods)
      setLocalTwoFactorMethod(availableMethods[0] ?? 'totp')
      setLocalTwoFactorRequired(true)
      return
    }

    router.push(inviteAcceptPath ?? '/dashboard')
  }

  async function onLocalTwoFactorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = cleanTwoFactorCode(localTwoFactorCode, localTwoFactorMethod)
    if (!code) return

    setServerError(null)
    setLocalTwoFactorSubmitting(true)
    try {
      const result = localTwoFactorMethod === 'backup_code'
        ? await authClient.twoFactor.verifyBackupCode({ code })
        : await authClient.twoFactor.verifyTotp({ code })

      if (result.error) {
        setServerError(result.error.message ?? 'Invalid two-factor code.')
        return
      }

      router.push(inviteAcceptPath ?? '/dashboard')
    } catch {
      setServerError('An unexpected error occurred.')
    } finally {
      setLocalTwoFactorSubmitting(false)
    }
  }

  async function onDomainSubmit(values: DomainLoginValues) {
    setServerError(null)
    setCanResendVerification(false)
    setVerificationEmail(null)
    try {
      const res = await fetch('/api/auth/ldap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ldapTwoFactorRequired
          ? {
              twoFactorCode: ldapTwoFactorCode,
              twoFactorMethod: ldapTwoFactorMethod,
            }
          : {
              organisationSlug: values.organisationSlug,
              username: values.username,
              password: values.password,
            }),
      })

      const data = await res.json()

      if (data.twoFactorRequired) {
        setLdapTwoFactorRequired(true)
        setLdapTwoFactorMethod('totp')
        setLdapTwoFactorCode('')
        return
      }

      if (!res.ok) {
        setServerError(data.error ?? 'Domain sign in failed.')
        return
      }

      router.push('/dashboard')
    } catch {
      setServerError('An unexpected error occurred.')
    }
  }

  async function onDomainTwoFactorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setServerError(null)

    try {
      const res = await fetch('/api/auth/ldap/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          twoFactorCode: ldapTwoFactorCode,
          twoFactorMethod: ldapTwoFactorMethod,
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

  function resetDomainTwoFactor() {
    setLdapTwoFactorRequired(false)
    setLdapTwoFactorCode('')
    setLdapTwoFactorMethod('totp')
  }

  function resetLocalTwoFactor() {
    setLocalTwoFactorRequired(false)
    setLocalTwoFactorCode('')
    setLocalTwoFactorMethod('totp')
    setLocalTwoFactorMethods(['totp'])
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
                setCanResendVerification(false)
                setVerificationEmail(null)
                resetDomainTwoFactor()
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
                setCanResendVerification(false)
                setVerificationEmail(null)
                resetLocalTwoFactor()
                resetDomainTwoFactor()
              }}
            >
              Domain Account
            </button>
          </div>
        </div>
      )}

      {loginMode === 'local' && localTwoFactorRequired ? (
        <form onSubmit={onLocalTwoFactorSubmit}>
          <CardContent className="space-y-4">
            {serverError && (
              <p className="text-sm text-destructive" data-testid="login-error">{serverError}</p>
            )}
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm" data-testid="login-2fa-panel">
              <p className="font-medium text-foreground">Second factor required</p>
              <p className="text-muted-foreground">
                Enter the code from your authenticator app or use one of your backup codes to finish signing in.
              </p>
            </div>
            {localTwoFactorMethods.length > 1 && (
              <div className="space-y-1.5">
                <Label>Verification method</Label>
                <div className="flex rounded-md border p-1 gap-1">
                  {localTwoFactorMethods.includes('totp') && (
                    <button
                      type="button"
                      className={`flex-1 px-3 py-1.5 text-sm rounded transition-colors ${
                        localTwoFactorMethod === 'totp'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setLocalTwoFactorMethod('totp')}
                      data-testid="login-2fa-method-totp"
                    >
                      Authenticator
                    </button>
                  )}
                  {localTwoFactorMethods.includes('backup_code') && (
                    <button
                      type="button"
                      className={`flex-1 px-3 py-1.5 text-sm rounded transition-colors ${
                        localTwoFactorMethod === 'backup_code'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setLocalTwoFactorMethod('backup_code')}
                      data-testid="login-2fa-method-backup"
                    >
                      Backup Code
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="login-two-factor-code">
                {localTwoFactorMethod === 'totp' ? 'Authenticator code' : 'Backup code'}
              </Label>
              <Input
                id="login-two-factor-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={localTwoFactorCode}
                onChange={(event) => setLocalTwoFactorCode(event.target.value)}
                data-testid="login-2fa-code"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button
              type="submit"
              className="w-full"
              disabled={localTwoFactorSubmitting || !cleanTwoFactorCode(localTwoFactorCode, localTwoFactorMethod)}
              data-testid="login-2fa-submit"
            >
              {localTwoFactorSubmitting ? 'Verifying...' : 'Verify code'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setServerError(null)
                resetLocalTwoFactor()
              }}
            >
              Start over
            </Button>
          </CardFooter>
        </form>
      ) : loginMode === 'local' ? (
        <form onSubmit={localForm.handleSubmit(onLocalSubmit)}>
          <CardContent className="space-y-4">
            {notice && (
              <p className="text-sm text-foreground" data-testid="login-notice">{notice}</p>
            )}
            {serverError && (
              <p className="text-sm text-destructive" data-testid="login-error">{serverError}</p>
            )}
            {canResendVerification && (
              <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
                <p className="text-muted-foreground">
                  Your account needs email verification before you can sign in. Use the link in
                  your verification email, or manage verification if the previous link expired.
                </p>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                >
                  <Link
                    href={`/check-email?${new URLSearchParams({
                      ...(verificationEmail ? { email: verificationEmail } : {}),
                      ...(inviteAcceptPath ? { callbackURL: inviteAcceptPath } : {}),
                    }).toString()}`}
                    data-testid="manage-email-verification"
                  >
                    Manage email verification
                  </Link>
                </Button>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                data-testid="login-email"
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
                data-testid="login-password"
                {...localForm.register('password')}
              />
              {localForm.formState.errors.password && (
                <p className="text-xs text-destructive">{localForm.formState.errors.password.message}</p>
              )}
            </div>
            <div className="text-right">
              <Link
                href="/forgot-password"
                className="text-sm text-foreground underline underline-offset-4"
                data-testid="forgot-password-link"
              >
                Forgot password?
              </Link>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button
              type="submit"
              className="w-full"
              disabled={localForm.formState.isSubmitting}
              data-testid="login-submit"
            >
              {localForm.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              Don&apos;t have an account?{' '}
              <Link
                href={getInviteRegisterPath(inviteToken)}
                className="text-foreground font-medium underline underline-offset-4"
              >
                Create one
              </Link>
            </p>
          </CardFooter>
        </form>
      ) : (
        <form onSubmit={ldapTwoFactorRequired ? onDomainTwoFactorSubmit : domainForm.handleSubmit(onDomainSubmit)}>
          <CardContent className="space-y-4">
            {serverError && (
              <p className="text-sm text-destructive">{serverError}</p>
            )}
            {ldapTwoFactorRequired ? (
              <>
                <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
                  <p className="font-medium text-foreground">Second factor required</p>
                  <p className="text-muted-foreground">
                    Enter the code from your authenticator app or use one of your backup codes to finish signing in.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Verification method</Label>
                  <div className="flex rounded-md border p-1 gap-1">
                    <button
                      type="button"
                      className={`flex-1 px-3 py-1.5 text-sm rounded transition-colors ${
                        ldapTwoFactorMethod === 'totp'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setLdapTwoFactorMethod('totp')}
                      data-testid="domain-2fa-method-totp"
                    >
                      Authenticator
                    </button>
                    <button
                      type="button"
                      className={`flex-1 px-3 py-1.5 text-sm rounded transition-colors ${
                        ldapTwoFactorMethod === 'backup_code'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setLdapTwoFactorMethod('backup_code')}
                      data-testid="domain-2fa-method-backup"
                    >
                      Backup Code
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="domain-two-factor-code">
                    {ldapTwoFactorMethod === 'totp' ? 'Authenticator code' : 'Backup code'}
                  </Label>
                  <Input
                    id="domain-two-factor-code"
                    type="text"
                    autoComplete="one-time-code"
                    value={ldapTwoFactorCode}
                    onChange={(event) => setLdapTwoFactorCode(event.target.value)}
                    data-testid="domain-2fa-code"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="domain-organisation">Organisation slug</Label>
                  <Input
                    id="domain-organisation"
                    type="text"
                    autoComplete="organization"
                    placeholder="acme"
                    {...domainForm.register('organisationSlug')}
                    data-testid="domain-login-organisation"
                  />
                  {domainForm.formState.errors.organisationSlug && (
                    <p className="text-xs text-destructive">{domainForm.formState.errors.organisationSlug.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="domain-username">Username</Label>
                  <Input
                    id="domain-username"
                    type="text"
                    autoComplete="username"
                    placeholder="jsmith"
                    {...domainForm.register('username')}
                    data-testid="domain-login-username"
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
                    data-testid="domain-login-password"
                  />
                  {domainForm.formState.errors.password && (
                    <p className="text-xs text-destructive">{domainForm.formState.errors.password.message}</p>
                  )}
                </div>
              </>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={domainForm.formState.isSubmitting || (ldapTwoFactorRequired && !ldapTwoFactorCode.trim())}>
              {domainForm.formState.isSubmitting
                ? (ldapTwoFactorRequired ? 'Verifying...' : 'Signing in...')
                : (ldapTwoFactorRequired ? 'Verify code' : 'Sign in with Domain Account')}
            </Button>
            {ldapTwoFactorRequired && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setServerError(null)
                  resetDomainTwoFactor()
                }}
              >
                Start over
              </Button>
            )}
          </CardFooter>
        </form>
      )}
    </Card>
  )
}
