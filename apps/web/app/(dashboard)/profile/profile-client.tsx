'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
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
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CheckCircle2, ShieldCheck, Sun, Moon, Monitor, Bell, Copy, KeyRound } from 'lucide-react'
import { updateName, updatePassword, updateTheme, updateNotificationPreference } from '@/lib/actions/profile'
import { getOrgNotificationSettings } from '@/lib/actions/notification-settings'
import type { SessionUser } from '@/lib/auth/session'
import { authClient } from '@/lib/auth/client'

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
  const searchParams = useSearchParams()
  const [nameSaveSuccess, setNameSaveSuccess] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [currentTheme, setCurrentTheme] = useState<Theme>((user.theme as Theme) ?? 'system')
  const [themeSaving, setThemeSaving] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(user.notificationsEnabled)
  const [notifSaveSuccess, setNotifSaveSuccess] = useState(false)
  const [notifError, setNotifError] = useState<string | null>(null)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(user.twoFactorEnabled)
  const [twoFactorPassword, setTwoFactorPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorUri, setTwoFactorUri] = useState('')
  const [twoFactorBackupCodes, setTwoFactorBackupCodes] = useState<string[]>([])
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null)
  const [twoFactorSuccess, setTwoFactorSuccess] = useState<string | null>(null)

  const twoFactorSecret = useMemo(() => {
    if (!twoFactorUri) return ''
    try {
      return new URL(twoFactorUri).searchParams.get('secret') ?? ''
    } catch {
      return ''
    }
  }, [twoFactorUri])
  const requireTwoFactorSetup = searchParams.get('setup') === 'two-factor' && !twoFactorEnabled

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

  const startTwoFactorMutation = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.enable({
        password: twoFactorPassword,
        issuer: 'CT-Ops',
      })
      if (res.error) throw new Error(res.error.message ?? 'Unable to start two-factor setup')
      return res.data
    },
    onSuccess: (data) => {
      setTwoFactorUri(data.totpURI)
      setTwoFactorBackupCodes(data.backupCodes ?? [])
      setTwoFactorError(null)
      setTwoFactorSuccess(null)
      setTwoFactorCode('')
    },
    onError: (err) => {
      setTwoFactorError(err instanceof Error ? err.message : 'Unable to start two-factor setup')
      setTwoFactorSuccess(null)
    },
  })

  const verifyTwoFactorMutation = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.verifyTotp({
        code: twoFactorCode.replace(/\s+/g, ''),
      })
      if (res.error) throw new Error(res.error.message ?? 'Invalid authenticator code')
      return res.data
    },
    onSuccess: () => {
      setTwoFactorEnabled(true)
      setTwoFactorPassword('')
      setTwoFactorCode('')
      setTwoFactorUri('')
      setTwoFactorError(null)
      setTwoFactorSuccess('Two-factor authentication is enabled')
    },
    onError: (err) => {
      setTwoFactorError(err instanceof Error ? err.message : 'Invalid authenticator code')
      setTwoFactorSuccess(null)
    },
  })

  const disableTwoFactorMutation = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.disable({
        password: twoFactorPassword,
      })
      if (res.error) throw new Error(res.error.message ?? 'Unable to disable two-factor authentication')
      return res.data
    },
    onSuccess: () => {
      setTwoFactorEnabled(false)
      setTwoFactorPassword('')
      setTwoFactorCode('')
      setTwoFactorUri('')
      setTwoFactorBackupCodes([])
      setTwoFactorError(null)
      setTwoFactorSuccess('Two-factor authentication is disabled')
    },
    onError: (err) => {
      setTwoFactorError(err instanceof Error ? err.message : 'Unable to disable two-factor authentication')
      setTwoFactorSuccess(null)
    },
  })

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your personal settings</p>
      </div>

      {requireTwoFactorSetup && (
        <Alert data-testid="profile-two-factor-required">
          <KeyRound className="size-4" />
          <AlertTitle>Two-factor authentication is required</AlertTitle>
          <AlertDescription>
            Your organisation requires an authenticator app before you can continue.
          </AlertDescription>
        </Alert>
      )}

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
              <p className="flex items-center gap-1 text-sm text-green-700" data-testid="profile-password-success">
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
                data-testid="profile-password-current"
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
                data-testid="profile-password-new"
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
                data-testid="profile-password-confirm"
                {...passwordForm.register('confirmPassword')}
              />
              {passwordForm.formState.errors.confirmPassword && (
                <p className="text-xs text-destructive">
                  {passwordForm.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>
            <Button type="submit" size="sm" disabled={passwordMutation.isPending} data-testid="profile-password-submit">
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
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {twoFactorEnabled ? '2FA is enabled' : '2FA is not enabled'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {twoFactorEnabled
                    ? 'Your account is protected with an authenticator app'
                    : 'Use an authenticator app to generate one-time codes'}
                </p>
              </div>
            </div>
            <Badge variant={twoFactorEnabled ? 'default' : 'outline'}>
              {twoFactorEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>

          {twoFactorError && (
            <p className="text-sm text-destructive">{twoFactorError}</p>
          )}
          {twoFactorSuccess && (
            <p className="flex items-center gap-1 text-sm text-green-700" data-testid="profile-two-factor-success">
              <CheckCircle2 className="size-4" />
              {twoFactorSuccess}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="profile-two-factor-password">Current password</Label>
            <Input
              id="profile-two-factor-password"
              type="password"
              autoComplete="current-password"
              value={twoFactorPassword}
              data-testid="profile-two-factor-password"
              onChange={(e) => setTwoFactorPassword(e.target.value)}
            />
          </div>

          {!twoFactorEnabled && !twoFactorUri && (
            <Button
              type="button"
              size="sm"
              disabled={!twoFactorPassword || startTwoFactorMutation.isPending}
              data-testid="profile-two-factor-start"
              onClick={() => {
                setTwoFactorError(null)
                setTwoFactorSuccess(null)
                startTwoFactorMutation.mutate()
              }}
            >
              {startTwoFactorMutation.isPending ? 'Starting…' : 'Set up authenticator'}
            </Button>
          )}

          {!twoFactorEnabled && twoFactorUri && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="profile-two-factor-secret">Authenticator setup key</Label>
                <div className="flex gap-2">
                  <Input
                    id="profile-two-factor-secret"
                    value={twoFactorSecret}
                    readOnly
                    className="font-mono text-xs"
                    data-testid="profile-two-factor-secret"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Copy setup key"
                    onClick={() => void navigator.clipboard.writeText(twoFactorSecret)}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-two-factor-uri">Authenticator URI</Label>
                <Textarea
                  id="profile-two-factor-uri"
                  value={twoFactorUri}
                  readOnly
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-two-factor-code">Verification code</Label>
                <Input
                  id="profile-two-factor-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={twoFactorCode}
                  data-testid="profile-two-factor-code"
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                />
              </div>
              {twoFactorBackupCodes.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Backup codes</Label>
                  <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-xs">
                    {twoFactorBackupCodes.map((code) => (
                      <span key={code}>{code}</span>
                    ))}
                  </div>
                </div>
              )}
              <Button
                type="button"
                size="sm"
                disabled={twoFactorCode.replace(/\s+/g, '').length < 6 || verifyTwoFactorMutation.isPending}
                data-testid="profile-two-factor-verify"
                onClick={() => {
                  setTwoFactorError(null)
                  setTwoFactorSuccess(null)
                  verifyTwoFactorMutation.mutate()
                }}
              >
                {verifyTwoFactorMutation.isPending ? 'Verifying…' : 'Verify and enable'}
              </Button>
            </div>
          )}

          {twoFactorEnabled && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!twoFactorPassword || disableTwoFactorMutation.isPending}
              data-testid="profile-two-factor-disable"
              onClick={() => {
                setTwoFactorError(null)
                setTwoFactorSuccess(null)
                disableTwoFactorMutation.mutate()
              }}
            >
              {disableTwoFactorMutation.isPending ? 'Disabling…' : 'Disable 2FA'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Choose how CT-Ops looks for you</CardDescription>
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
                  data-testid={`profile-theme-${option.value}`}
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
                data-testid="profile-notifications-toggle"
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
              <span className="flex items-center gap-1 text-sm text-green-700" data-testid="profile-notifications-success">
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
