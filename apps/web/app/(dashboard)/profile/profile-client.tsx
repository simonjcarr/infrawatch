'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { CheckCircle2, ShieldCheck, Sun, Moon, Monitor, Bell } from 'lucide-react'
import { updateName, updatePassword, updateTheme, updateNotificationPreference } from '@/lib/actions/profile'
import { getOrgNotificationSettings } from '@/lib/actions/notification-settings'
import type { SessionUser } from '@/lib/auth/session'

type Theme = 'light' | 'dark' | 'system'

const THEME_OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun className="size-4" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
  { value: 'system', label: 'System', icon: <Monitor className="size-4" /> },
]

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }
}

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
  orgId: string
}

export function ProfileClient({ user, orgId }: ProfileClientProps) {
  const [nameSaveSuccess, setNameSaveSuccess] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [currentTheme, setCurrentTheme] = useState<Theme>((user.theme as Theme) ?? 'system')
  const [themeSaving, setThemeSaving] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(user.notificationsEnabled)
  const [notifSaveSuccess, setNotifSaveSuccess] = useState(false)
  const [notifError, setNotifError] = useState<string | null>(null)

  const { data: orgNotifSettings } = useQuery({
    queryKey: ['org-notification-settings', orgId],
    queryFn: () => getOrgNotificationSettings(orgId),
    enabled: !!orgId,
  })

  const notifMutation = useMutation({
    mutationFn: (enabled: boolean) => updateNotificationPreference(user.id, orgId, enabled),
    onSuccess: (result) => {
      if ('error' in result) {
        setNotifError(result.error)
        setNotificationsEnabled(user.notificationsEnabled) // revert
        return
      }
      setNotifSaveSuccess(true)
      setNotifError(null)
      setTimeout(() => setNotifSaveSuccess(false), 3000)
    },
  })

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

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Choose how Infrawatch looks for you</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {THEME_OPTIONS.map((option) => {
              const isSelected = currentTheme === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={themeSaving}
                  onClick={async () => {
                    if (isSelected) return
                    setCurrentTheme(option.value)
                    applyTheme(option.value)
                    setThemeSaving(true)
                    await updateTheme(user.id, option.value)
                    setThemeSaving(false)
                  }}
                  className={`flex flex-col items-center gap-2 rounded-lg border px-5 py-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                    isSelected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {option.icon}
                  {option.label}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      {orgNotifSettings?.inAppEnabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="size-4 text-muted-foreground" />
              Notifications
            </CardTitle>
            <CardDescription>
              {orgNotifSettings.allowUserOptOut
                ? 'Control whether you receive in-app notifications for alert events'
                : 'Your organisation requires in-app notifications for your role'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">In-app notifications</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Receive a notification when alerts fire or resolve
                </p>
              </div>
              <Switch
                checked={notificationsEnabled}
                disabled={!orgNotifSettings.allowUserOptOut || notifMutation.isPending}
                onCheckedChange={(checked) => {
                  setNotificationsEnabled(checked)
                  notifMutation.mutate(checked)
                }}
              />
            </div>
            {notifError && (
              <p className="text-xs text-destructive">{notifError}</p>
            )}
            {notifSaveSuccess && (
              <span className="flex items-center gap-1 text-sm text-green-700">
                <CheckCircle2 className="size-4" />
                Saved
              </span>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
