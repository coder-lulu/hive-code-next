import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { guardedSafeStorage as safeStorage } from '../host/safe-storage-availability'
import { applyProductBranding } from '../../shared/brand'
import { isUnreadableError, writeSecureJsonFile } from '../../shared/secure-file'
import type {
  OrcaCloudCapabilities,
  OrcaCloudOrgSummary,
  OrcaCloudSessionPersistence
} from '../../shared/orca-profiles'
import { getOrcaProfileDirectory } from './profile-storage-paths'
import { allowsPlaintextOrcaCloudSession } from './profile-cloud-auth-config'
import { ElectronSecretStore } from '../host/electron-secret-store'

export type OrcaCloudSession = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  capabilities: OrcaCloudCapabilities
  organizations?: OrcaCloudOrgSummary[]
}

export type OrcaCloudSessionReadResult =
  | { status: 'found'; session: OrcaCloudSession; persistence: OrcaCloudSessionPersistence }
  | { status: 'missing'; persistence: 'none' }
  | { status: 'decrypt-failed'; persistence: 'none'; error: string }
  /**
   * The file is there and this process may not read it. Distinct from `decrypt-failed` because
   * that one means "read it, it was garbage" and licenses replacing it; this one licenses nothing.
   */
  | { status: 'unreadable'; persistence: 'none'; error: string }

type PersistedEncryptedSession = {
  version: 1
  format: 'electron-safe-storage-v1'
  savedAt: number
  ciphertext: string
}

type PersistedPlaintextSession = {
  version: 1
  format: 'dev-plaintext-v1'
  savedAt: number
  session: OrcaCloudSession
}

type CachedOrcaCloudSession = {
  session: OrcaCloudSession
  persistence: Exclude<OrcaCloudSessionPersistence, 'none'>
}

const memorySessions = new Map<string, CachedOrcaCloudSession>()
export const MAX_MEMORY_CLOUD_SESSIONS = 64

function rememberMemorySession(key: string, session: CachedOrcaCloudSession): void {
  memorySessions.delete(key)
  memorySessions.set(key, session)
  while (memorySessions.size > MAX_MEMORY_CLOUD_SESSIONS) {
    const oldest = memorySessions.keys().next()
    if (oldest.done || oldest.value === key) {
      break
    }
    memorySessions.delete(oldest.value)
  }
}

export function orcaCloudSessionKey(profileId: string, userDataPath: string): string {
  return `${userDataPath}\0${profileId}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOrcaCloudSession(value: unknown): value is OrcaCloudSession {
  if (!isObject(value) || !isObject(value.capabilities) || !isObject(value.capabilities.flags)) {
    return false
  }
  if (value.organizations !== undefined && !isOrcaCloudOrganizations(value.organizations)) {
    return false
  }
  return (
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken.length > 0 &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    typeof value.capabilities.refreshedAt === 'number' &&
    Number.isFinite(value.capabilities.refreshedAt)
  )
}

function isOrcaCloudOrganizations(value: unknown): value is OrcaCloudOrgSummary[] {
  if (!Array.isArray(value)) {
    return false
  }
  return value.every((organization) => {
    if (!isObject(organization)) {
      return false
    }
    return (
      typeof organization.orgId === 'string' &&
      organization.orgId.length > 0 &&
      typeof organization.name === 'string' &&
      organization.name.length > 0 &&
      (organization.role === undefined || typeof organization.role === 'string')
    )
  })
}

export function getOrcaCloudSessionPath(profileId: string, userDataPath: string): string {
  return join(getOrcaProfileDirectory(profileId, userDataPath), 'account-session.json.enc')
}

// Rotated sessions whose write failed. The token on disk is already spent, so each is retried
// on the next read and at quit until it lands or the session changes.
const unsavedRotations = new Map<
  string,
  { profileId: string; userDataPath: string; session: OrcaCloudSession; canPersist?: () => boolean }
>()

function writeOrcaCloudSession(
  profileId: string,
  userDataPath: string,
  session: OrcaCloudSession
): OrcaCloudSessionPersistence {
  const cacheKey = orcaCloudSessionKey(profileId, userDataPath)
  const secretStore = new ElectronSecretStore()
  let protectedAtRest = false
  try {
    protectedAtRest =
      secretStore.isEncryptionAvailable() && secretStore.describeProtectionGap() === null
  } catch {
    // An unverified backend cannot authorize a persistent session write.
  }
  if (protectedAtRest) {
    const encrypted: PersistedEncryptedSession = {
      version: 1,
      format: 'electron-safe-storage-v1',
      savedAt: Date.now(),
      ciphertext: secretStore.encryptString(JSON.stringify(session)).toString('base64')
    }
    writeSecureJsonFile(getOrcaCloudSessionPath(profileId, userDataPath), encrypted)
    rememberMemorySession(cacheKey, { session, persistence: 'encrypted' })
    return 'encrypted'
  }

  // Keep refresh tokens out of persistent storage until the OS keyring is verifiable.
  // Existing dev plaintext files remain readable under their original guard.
  rememberMemorySession(cacheKey, { session, persistence: 'memory-only' })
  return 'memory-only'
}

export function saveOrcaCloudSession(
  profileId: string,
  userDataPath: string,
  session: OrcaCloudSession,
  options: { spentOnFailure?: boolean; canPersist?: () => boolean } = {}
): OrcaCloudSessionPersistence {
  const key = orcaCloudSessionKey(profileId, userDataPath)
  try {
    const persistence = writeOrcaCloudSession(profileId, userDataPath, session)
    const previousRotation = unsavedRotations.get(key)
    const carriesUnsavedRotation = previousRotation?.session.refreshToken === session.refreshToken
    if (persistence === 'memory-only' && (options.spentOnFailure || carriesUnsavedRotation)) {
      unsavedRotations.set(key, {
        profileId,
        userDataPath,
        session,
        canPersist:
          options.canPersist ?? (carriesUnsavedRotation ? previousRotation?.canPersist : undefined)
      })
      try {
        rmSync(getOrcaCloudSessionPath(profileId, userDataPath), { force: true })
      } catch {
        // Keep the rotated token in memory until protected storage becomes available.
      }
    } else {
      unsavedRotations.delete(key)
    }
    return persistence
  } catch (error) {
    // A failed non-rotating write throws as before and leaves any unsaved rotation pending.
    if (!options.spentOnFailure) {
      throw error
    }
    // Why: losing a rotated token makes the next refresh resend the spent one, which the
    // server reads as reuse and revokes the whole family.
    unsavedRotations.set(key, { profileId, userDataPath, session, canPersist: options.canPersist })
    try {
      rmSync(getOrcaCloudSessionPath(profileId, userDataPath), { force: true })
    } catch {
      // A spent token left on disk costs one sign-in after restart, never a loop.
    }
    return 'memory-only'
  }
}

function retryUnsavedRotation(key: string): void {
  const unsaved = unsavedRotations.get(key)
  if (!unsaved) {
    return
  }
  if (unsaved.canPersist && !unsaved.canPersist()) {
    unsavedRotations.delete(key)
    memorySessions.delete(key)
    return
  }
  try {
    const persistence = writeOrcaCloudSession(
      unsaved.profileId,
      unsaved.userDataPath,
      unsaved.session
    )
    if (persistence !== 'memory-only') {
      unsavedRotations.delete(key)
    }
  } catch {
    // Still unsaved; the next read or the quit flush tries again.
  }
}

export function flushUnsavedOrcaCloudSessions(): void {
  for (const key of unsavedRotations.keys()) {
    retryUnsavedRotation(key)
  }
}

export function readOrcaCloudSession(
  profileId: string,
  userDataPath: string
): OrcaCloudSessionReadResult {
  const cacheKey = orcaCloudSessionKey(profileId, userDataPath)
  retryUnsavedRotation(cacheKey)
  const unsaved = unsavedRotations.get(cacheKey)
  if (unsaved) {
    return { status: 'found', session: unsaved.session, persistence: 'memory-only' }
  }
  const memorySession = memorySessions.get(cacheKey)
  if (memorySession) {
    memorySessions.delete(cacheKey)
    memorySessions.set(cacheKey, memorySession)
    return {
      status: 'found',
      session: memorySession.session,
      persistence: memorySession.persistence
    }
  }

  const path = getOrcaCloudSessionPath(profileId, userDataPath)
  if (!existsSync(path)) {
    return { status: 'missing', persistence: 'none' }
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as
      | PersistedEncryptedSession
      | PersistedPlaintextSession
    if (parsed.version !== 1) {
      return { status: 'decrypt-failed', persistence: 'none', error: 'Unsupported session format.' }
    }
    if (parsed.format === 'electron-safe-storage-v1') {
      if (!safeStorage.isEncryptionAvailable()) {
        return {
          status: 'decrypt-failed',
          persistence: 'none',
          error: 'OS-backed encryption is unavailable.'
        }
      }
      const decrypted = safeStorage.decryptString(Buffer.from(parsed.ciphertext, 'base64'))
      const session = JSON.parse(decrypted) as OrcaCloudSession
      if (!isOrcaCloudSession(session)) {
        return { status: 'decrypt-failed', persistence: 'none', error: 'Invalid saved session.' }
      }
      rememberMemorySession(cacheKey, { session, persistence: 'encrypted' })
      return { status: 'found', session, persistence: 'encrypted' }
    }
    if (parsed.format === 'dev-plaintext-v1' && allowsPlaintextOrcaCloudSession()) {
      if (!isOrcaCloudSession(parsed.session)) {
        return { status: 'decrypt-failed', persistence: 'none', error: 'Invalid saved session.' }
      }
      rememberMemorySession(cacheKey, { session: parsed.session, persistence: 'dev-plaintext' })
      return { status: 'found', session: parsed.session, persistence: 'dev-plaintext' }
    }
    return { status: 'decrypt-failed', persistence: 'none', error: 'Unsafe session format.' }
  } catch (error) {
    if (isUnreadableError(error)) {
      return {
        status: 'unreadable',
        persistence: 'none',
        error: applyProductBranding('Cannot read the saved Orca account session: the read failed.')
      }
    }
    return {
      status: 'decrypt-failed',
      persistence: 'none',
      error: applyProductBranding('Could not decrypt saved Orca account session.')
    }
  }
}

export function clearOrcaCloudSession(profileId: string, userDataPath: string): void {
  const key = orcaCloudSessionKey(profileId, userDataPath)
  unsavedRotations.delete(key)
  memorySessions.delete(key)
  rmSync(getOrcaCloudSessionPath(profileId, userDataPath), { force: true })
}

export function getOrcaCloudMemorySessionCountForTests(): number {
  return memorySessions.size
}
