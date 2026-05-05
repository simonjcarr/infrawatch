import { PasswordManagerApiError } from './client.ts'
import type {
  PasswordManagerEncryptedPrivateKeyEnvelope,
  PasswordManagerKdfMetadata,
} from './browser-crypto.ts'

export type PasswordManagerShellView =
  | 'launching'
  | 'locked'
  | 'unlocked'
  | 'session-expired'
  | 'access-denied'
  | 'object-unavailable'
  | 'operational-failure'

export interface PasswordManagerActiveKeyPair {
  privateKey: unknown
  publicKey: unknown
}

export interface PasswordManagerShellState {
  organisationId: string
  activeKeyPair: PasswordManagerActiveKeyPair | null
  encryptedPrivateKeyEnvelope: PasswordManagerEncryptedPrivateKeyEnvelope | null
  launchNonce: number
  needsRelaunch: boolean
  setupError: string | null
  setupConfigured: boolean | null
  unlockError: string | null
  unlockMetadata: PasswordManagerKdfMetadata | null
  view: PasswordManagerShellView
}

export type PasswordManagerShellEvent =
  | { type: 'launch-succeeded'; setupConfigured: boolean }
  | { type: 'launch-failed'; view: Exclude<PasswordManagerShellView, 'launching' | 'locked' | 'unlocked'> }
  | { type: 'unlock-metadata-loaded'; kdfMetadata: PasswordManagerKdfMetadata }
  | { type: 'setup-failed'; message: string }
  | {
      type: 'setup-succeeded'
      encryptedPrivateKeyEnvelope: PasswordManagerEncryptedPrivateKeyEnvelope
      kdfMetadata: PasswordManagerKdfMetadata
      keyPair: PasswordManagerActiveKeyPair
    }
  | { type: 'unlock-material-loaded'; encryptedPrivateKeyEnvelope: PasswordManagerEncryptedPrivateKeyEnvelope }
  | {
      type: 'unlock-succeeded'
      encryptedPrivateKeyEnvelope: PasswordManagerEncryptedPrivateKeyEnvelope
      kdfMetadata: PasswordManagerKdfMetadata
      keyPair: PasswordManagerActiveKeyPair
    }
  | { type: 'unlock-failed'; message: string; needsRelaunch: boolean }
  | { type: 'lock' }
  | { type: 'restart-launch' }
  | { type: 'organisation-changed'; organisationId: string }

export function createInitialPasswordManagerShellState(organisationId: string): PasswordManagerShellState {
  return {
    organisationId,
    activeKeyPair: null,
    encryptedPrivateKeyEnvelope: null,
    launchNonce: 0,
    needsRelaunch: false,
    setupError: null,
    setupConfigured: null,
    unlockError: null,
    unlockMetadata: null,
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
        activeKeyPair: null,
        encryptedPrivateKeyEnvelope: null,
        needsRelaunch: false,
        setupError: null,
        setupConfigured: event.setupConfigured,
        unlockError: null,
        unlockMetadata: null,
        view: 'locked',
      }
    case 'launch-failed':
      return {
        ...state,
        activeKeyPair: null,
        encryptedPrivateKeyEnvelope: null,
        needsRelaunch: false,
        setupConfigured: null,
        setupError: null,
        unlockError: null,
        unlockMetadata: null,
        view: event.view,
      }
    case 'unlock-metadata-loaded':
      return {
        ...state,
        unlockMetadata: event.kdfMetadata,
      }
    case 'setup-failed':
      return {
        ...state,
        activeKeyPair: null,
        encryptedPrivateKeyEnvelope: null,
        needsRelaunch: false,
        setupError: event.message,
        unlockError: null,
        view: 'locked',
      }
    case 'setup-succeeded':
      return {
        ...state,
        activeKeyPair: event.keyPair,
        encryptedPrivateKeyEnvelope: event.encryptedPrivateKeyEnvelope,
        needsRelaunch: false,
        setupConfigured: true,
        setupError: null,
        unlockError: null,
        unlockMetadata: event.kdfMetadata,
        view: 'unlocked',
      }
    case 'unlock-material-loaded':
      return {
        ...state,
        encryptedPrivateKeyEnvelope: event.encryptedPrivateKeyEnvelope,
      }
    case 'unlock-succeeded':
      return {
        ...state,
        activeKeyPair: event.keyPair,
        encryptedPrivateKeyEnvelope: event.encryptedPrivateKeyEnvelope,
        needsRelaunch: false,
        setupError: null,
        unlockError: null,
        unlockMetadata: event.kdfMetadata,
        view: 'unlocked',
      }
    case 'unlock-failed':
      return {
        ...state,
        activeKeyPair: null,
        encryptedPrivateKeyEnvelope: null,
        needsRelaunch: event.needsRelaunch,
        setupError: null,
        unlockError: event.message,
        view: 'locked',
      }
    case 'lock':
      return {
        ...state,
        activeKeyPair: null,
        needsRelaunch: false,
        setupError: null,
        unlockError: null,
        view: 'locked',
      }
    case 'restart-launch':
      return {
        ...createInitialPasswordManagerShellState(state.organisationId),
        launchNonce: state.launchNonce + 1,
      }
    case 'organisation-changed':
      return {
        ...createInitialPasswordManagerShellState(event.organisationId),
        launchNonce: state.launchNonce + 1,
      }
  }
}
