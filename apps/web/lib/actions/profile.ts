'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { users, organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { headers, cookies } from 'next/headers'
import type { OrgMetadata } from '@/lib/db/schema/organisations'

const updateNameSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
})

export async function updateName(
  userId: string,
  name: string,
): Promise<{ success: true } | { error: string }> {
  const parsed = updateNameSchema.safeParse({ name })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid name' }
  }

  try {
    await db
      .update(users)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(eq(users.id, userId))

    return { success: true }
  } catch (err) {
    console.error('Failed to update name:', err)
    return { error: 'An unexpected error occurred' }
  }
}

const updateEmailSchema = z.object({
  email: z
    .string()
    .email('Enter a valid email address')
    .refine((e) => !e.endsWith('@ldap.local'), 'Please enter a real email address'),
})

export async function updateEmail(
  userId: string,
  email: string,
): Promise<{ success: true } | { error: string }> {
  const parsed = updateEmailSchema.safeParse({ email })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid email' }
  }

  try {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, parsed.data.email),
    })
    if (existing && existing.id !== userId) {
      return { error: 'This email address is already in use' }
    }

    await db
      .update(users)
      .set({ email: parsed.data.email, updatedAt: new Date() })
      .where(eq(users.id, userId))

    return { success: true }
  } catch (err) {
    console.error('Failed to update email:', err)
    return { error: 'An unexpected error occurred' }
  }
}

const themeSchema = z.enum(['light', 'dark', 'system'])

export async function updateTheme(
  userId: string,
  theme: string,
): Promise<{ success: true } | { error: string }> {
  const parsed = themeSchema.safeParse(theme)
  if (!parsed.success) {
    return { error: 'Invalid theme value' }
  }

  try {
    await db
      .update(users)
      .set({ theme: parsed.data, updatedAt: new Date() })
      .where(eq(users.id, userId))

    const cookieStore = await cookies()
    cookieStore.set('theme', parsed.data, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      httpOnly: false,
    })

    return { success: true }
  } catch (err) {
    console.error('Failed to update theme:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateNotificationPreference(
  userId: string,
  orgId: string,
  enabled: boolean,
): Promise<{ success: true } | { error: string }> {
  // Check whether the org allows users to opt out
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  const meta = (org?.metadata ?? {}) as OrgMetadata
  const allowOptOut = meta.notificationSettings?.allowUserOptOut !== false

  if (!allowOptOut && !enabled) {
    return { error: 'Your organisation does not allow opting out of notifications' }
  }

  try {
    await db
      .update(users)
      .set({ notificationsEnabled: enabled, updatedAt: new Date() })
      .where(eq(users.id, userId))
    return { success: true }
  } catch {
    return { error: 'Failed to update notification preference' }
  }
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
})

export async function updatePassword(
  _userId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<{ success: true } | { error: string }> {
  const parsed = changePasswordSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  try {
    const reqHeaders = await headers()
    const cookie = reqHeaders.get('cookie') ?? ''
    const baseUrl = process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000'

    const response = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
        origin: baseUrl,
      },
      body: JSON.stringify({
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      }),
    })

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string }
      return { error: data.message ?? 'Incorrect current password' }
    }

    return { success: true }
  } catch (err) {
    console.error('Failed to change password:', err)
    return { error: 'An unexpected error occurred' }
  }
}
