'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'

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
