import { PasswordManagerApiError } from './client.ts'

export type PasswordManagerShellView =
  | 'launching'
  | 'locked'
  | 'unlocked'
  | 'session-expired'
  | 'access-denied'
  | 'object-unavailable'
  | 'operational-failure'

export interface PasswordManagerShellState {
  organisationId: string
  launchNonce: number
  setupConfigured: boolean | null
  view: PasswordManagerShellView
}

export type PasswordManagerShellEvent =
  | { type: 'launch-succeeded'; setupConfigured: boolean }
  | { type: 'launch-failed'; view: Exclude<PasswordManagerShellView, 'launching' | 'locked' | 'unlocked'> }
  | { type: 'unlock-succeeded' }
  | { type: 'lock' }
  | { type: 'restart-launch' }
  | { type: 'organisation-changed'; organisationId: string }

export function createInitialPasswordManagerShellState(organisationId: string): PasswordManagerShellState {
  return {
    organisationId,
    launchNonce: 0,
    setupConfigured: null,
    view: 'launching',
  }
}

export function mapPasswordManagerErrorToShellView(
  error: unknown,
): Exclude<PasswordManagerShellView, 'launching' | 'locked' | 'unlocked'> {
  if (error instanceof PasswordManagerApiError) {
    switch (error.status) {
      case 401:
        return 'session-expired'
      case 403:
        return 'access-denied'
      case 404:
        return 'object-unavailable'
      default:
        return 'operational-failure'
    }
  }

  return 'operational-failure'
}

export function reducePasswordManagerShellState(
  state: PasswordManagerShellState,
  event: PasswordManagerShellEvent,
): PasswordManagerShellState {
  switch (event.type) {
    case 'launch-succeeded':
      return {
        ...state,
        setupConfigured: event.setupConfigured,
        view: 'locked',
      }
    case 'launch-failed':
      return {
        ...state,
        setupConfigured: null,
        view: event.view,
      }
    case 'unlock-succeeded':
      return {
        ...state,
        view: 'unlocked',
      }
    case 'lock':
      return {
        ...state,
        view: 'locked',
      }
    case 'restart-launch':
      return {
        ...state,
        launchNonce: state.launchNonce + 1,
        setupConfigured: null,
        view: 'launching',
      }
    case 'organisation-changed':
      return {
        organisationId: event.organisationId,
        launchNonce: state.launchNonce + 1,
        setupConfigured: null,
        view: 'launching',
      }
  }
}
