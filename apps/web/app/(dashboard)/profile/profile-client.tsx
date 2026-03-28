'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { updateName, updatePassword } from '@/lib/actions/profile'
import type { SessionUser } from '@/lib/auth/session'

const nameSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
})
type NameValues = z.infer<typeof nameSchema>

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
type PasswordValues = z.infer<typeof passwordSchema>

interface ProfileClientProps {
  user: SessionUser
}

export function ProfileClient({ user }: ProfileClientProps) {
  const [nameSaveSuccess, setNameSaveSuccess] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const nameForm = useForm<NameValues>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: user.name },
  })

  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
  })

  const nameMutation = useMutation({
    mutationFn: (values: NameValues) => updateName(user.id, values.name),
    onSuccess: (result) => {
      if ('error' in result) {
        nameForm.setError('name', { message: result.error })
        return
      }
      setNameSaveSuccess(true)
      setTimeout(() => setNameSaveSuccess(false), 3000)
    },
  })

  const passwordMutation = useMutation({
    mutationFn: (values: PasswordValues) =>
      updatePassword(user.id, {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }),
    onSuccess: (result) => {
      if ('error' in result) {
        setPasswordError(result.error)
        return
      }
      setPasswordSuccess(true)
      setPasswordError(null)
      passwordForm.reset()
      setTimeout(() => setPasswordSuccess(false), 4000)
    },
  })

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your personal settings</p>
      </div>

      {/* Personal info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal information</CardTitle>
          <CardDescription>Update your display name</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={nameForm.handleSubmit((v) => nameMutation.mutate(v))}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Full name</Label>
              <Input id="profile-name" {...nameForm.register('name')} />
              {nameForm.formState.errors.name && (
                <p className="text-xs text-destructive">
                  {nameForm.formState.errors.name.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={user.email} disabled className="text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Email cannot be changed here</p>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={nameMutation.isPending}>
                {nameMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
              {nameSaveSuccess && (
                <span className="flex items-center gap-1 text-sm text-green-700">
                  <CheckCircle2 className="size-4" />
                  Saved
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
          <CardDescription>Update your account password</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={passwordForm.handleSubmit((v) => {
              setPasswordError(null)
              setPasswordSuccess(false)
              passwordMutation.mutate(v)
            })}
            className="space-y-4"
          >
            {passwordError && (
              <p className="text-sm text-destructive">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="flex items-center gap-1 text-sm text-green-700">
                <CheckCircle2 className="size-4" />
                Password updated successfully
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                {...passwordForm.register('currentPassword')}
              />
              {passwordForm.formState.errors.currentPassword && (
                <p className="text-xs text-destructive">
                  {passwordForm.formState.errors.currentPassword.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                {...passwordForm.register('newPassword')}
              />
              {passwordForm.formState.errors.newPassword && (
                <p className="text-xs text-destructive">
                  {passwordForm.formState.errors.newPassword.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                {...passwordForm.register('confirmPassword')}
              />
              {passwordForm.formState.errors.confirmPassword && (
                <p className="text-xs text-destructive">
                  {passwordForm.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>
            <Button type="submit" size="sm" disabled={passwordMutation.isPending}>
              {passwordMutation.isPending ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Two-factor authentication */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Two-factor authentication</CardTitle>
          <CardDescription>
            Add an extra layer of security to your account with TOTP
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {user.twoFactorEnabled ? '2FA is enabled' : '2FA is not enabled'}
              </p>
              <p className="text-xs text-muted-foreground">
                {user.twoFactorEnabled
                  ? 'Your account is protected with an authenticator app'
                  : 'Use an authenticator app to generate one-time codes'}
              </p>
            </div>
          </div>
          <Badge variant={user.twoFactorEnabled ? 'default' : 'outline'}>
            {user.twoFactorEnabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </CardContent>
      </Card>
    </div>
  )
}
