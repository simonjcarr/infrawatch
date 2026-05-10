import { PasswordManagerApiError } from './client.ts'
import type { PasswordManagerShellView } from './shell.ts'

type ShellErrorView = Exclude<PasswordManagerShellView, 'launching' | 'locked' | 'unlocked'>

export type PasswordManagerUiError =
  | {
      kind: 'message'
      message: string
    }
  | {
      kind: 'shell-view'
      message: string
      view: Exclude<ShellErrorView, 'object-unavailable'>
    }
  | {
      kind: 'object-unavailable'
      message: string
      view: 'object-unavailable'
    }

export function normalizePasswordManagerUiError(
  error: unknown,
  fallbackMessage: string,
): PasswordManagerUiError {
  if (!(error instanceof PasswordManagerApiError)) {
    return {
      kind: 'message',
      message: fallbackMessage,
    }
  }

  switch (error.status) {
    case 400:
      return {
        kind: 'message',
        message: 'Password Manager rejected that request. Refresh the workspace and retry.',
      }
    case 401:
      return {
        kind: 'shell-view',
        message: 'Your Password Manager session expired. Relaunch and try again.',
        view: 'session-expired',
      }
    case 403:
      return {
        kind: 'shell-view',
        message: 'Your current session cannot access Password Manager. Relaunch or switch instance access.',
        view: 'access-denied',
      }
    case 404:
      return {
        kind: 'object-unavailable',
        message: 'The requested vault or entry is no longer available. Refresh the workspace and try again.',
        view: 'object-unavailable',
      }
    case 409:
      return {
        kind: 'message',
        message: 'Password Manager rejected that change because the current state changed. Refresh and retry.',
      }
    case 429:
      return {
        kind: 'message',
        message: 'Password Manager rate limited that action. Wait a moment and retry.',
      }
    default:
      return {
        kind: 'shell-view',
        message: 'Password Manager is temporarily unavailable. Retry shortly.',
        view: 'operational-failure',
      }
  }
}

export function shouldLogPasswordManagerError(error: unknown): boolean {
  return !(
    error instanceof PasswordManagerApiError &&
    [400, 401, 403, 404, 409, 429].includes(error.status)
  )
}
