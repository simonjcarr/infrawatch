import { request as playwrightRequest } from '@playwright/test'
import path from 'node:path'
import { TEST_USER } from './seed'

export const STORAGE_STATE_PATH = path.resolve(
  __dirname,
  '..',
  '.auth',
  'user.json',
)

export async function getStorageStatePath(baseURL: string): Promise<string> {
  return signInAndCacheStorageState(baseURL)
}

async function signInAndCacheStorageState(baseURL: string): Promise<string> {
  const ctx = await playwrightRequest.newContext({ baseURL })
  try {
    const res = await ctx.post('/api/auth/sign-in/email', {
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
    })
    if (!res.ok()) {
      const body = await res.text()
      throw new Error(`sign-in failed: ${res.status()} ${body}`)
    }
    await ctx.storageState({ path: STORAGE_STATE_PATH })
  } finally {
    await ctx.dispose()
  }
  return STORAGE_STATE_PATH
}
