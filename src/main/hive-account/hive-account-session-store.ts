import type { HiveAccountSessionProfile, HiveAccountSummary } from '../../shared/hive-account'
import {
  deleteSecureJson,
  hiveAccountSecurePath,
  readSecureJson,
  writeSecureJson,
  type SecureReadResult
} from './hive-account-secure-store'

export type HiveAccountSession = {
  schemaVersion: 2
  accessToken: string
  refreshToken: string
  expiresAt: number
  sessionExpiresAt: number
  sessionProfile: HiveAccountSessionProfile
  account: HiveAccountSummary
  authorityId: string
  deviceLabel: string
  generation: number
  savedAt: number
}

type LegacyHiveAccountSession = Omit<
  HiveAccountSession,
  'schemaVersion' | 'sessionExpiresAt' | 'sessionProfile'
> & { schemaVersion: 1 }

type StoredHiveAccountSession = HiveAccountSession | LegacyHiveAccountSession

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSession(value: unknown): value is StoredHiveAccountSession {
  if (!isRecord(value) || !isRecord(value.account)) {
    return false
  }
  return (
    (value.schemaVersion === 1 || value.schemaVersion === 2) &&
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken.length > 0 &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    typeof value.account.accountId === 'string' &&
    typeof value.account.displayName === 'string' &&
    typeof value.authorityId === 'string' &&
    typeof value.deviceLabel === 'string' &&
    typeof value.generation === 'number' &&
    Number.isSafeInteger(value.generation) &&
    typeof value.savedAt === 'number' &&
    (value.schemaVersion === 1 ||
      (typeof value.sessionExpiresAt === 'number' &&
        Number.isFinite(value.sessionExpiresAt) &&
        value.sessionExpiresAt > value.expiresAt &&
        ['TEMPORARY', 'TRUSTED', 'LEGACY'].includes(String(value.sessionProfile))))
  )
}

function sessionPath(userDataPath: string): string {
  return hiveAccountSecurePath(userDataPath, 'native-session.v1.enc')
}

export function readHiveAccountSession(userDataPath: string): SecureReadResult<HiveAccountSession> {
  const stored = readSecureJson(sessionPath(userDataPath), isSession)
  if (stored.status !== 'ok' || stored.value.schemaVersion === 2) {
    return stored as SecureReadResult<HiveAccountSession>
  }
  return {
    status: 'ok',
    value: {
      ...stored.value,
      schemaVersion: 2,
      sessionProfile: 'LEGACY',
      sessionExpiresAt: Math.max(
        stored.value.expiresAt + 1_000,
        stored.value.savedAt + 90 * 24 * 60 * 60 * 1_000
      )
    }
  }
}

export function saveHiveAccountSession(userDataPath: string, session: HiveAccountSession): boolean {
  return writeSecureJson(sessionPath(userDataPath), session)
}

export function clearHiveAccountSession(userDataPath: string): void {
  deleteSecureJson(sessionPath(userDataPath))
}
