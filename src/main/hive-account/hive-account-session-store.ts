import type { HiveAccountSummary } from '../../shared/hive-account'
import {
  deleteSecureJson,
  hiveAccountSecurePath,
  readSecureJson,
  writeSecureJson,
  type SecureReadResult
} from './hive-account-secure-store'

export type HiveAccountSession = {
  schemaVersion: 1
  accessToken: string
  refreshToken: string
  expiresAt: number
  account: HiveAccountSummary
  authorityId: string
  deviceLabel: string
  generation: number
  savedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSession(value: unknown): value is HiveAccountSession {
  if (!isRecord(value) || !isRecord(value.account)) {
    return false
  }
  return (
    value.schemaVersion === 1 &&
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
    typeof value.savedAt === 'number'
  )
}

function sessionPath(userDataPath: string): string {
  return hiveAccountSecurePath(userDataPath, 'native-session.v1.enc')
}

export function readHiveAccountSession(userDataPath: string): SecureReadResult<HiveAccountSession> {
  return readSecureJson(sessionPath(userDataPath), isSession)
}

export function saveHiveAccountSession(userDataPath: string, session: HiveAccountSession): boolean {
  return writeSecureJson(sessionPath(userDataPath), session)
}

export function clearHiveAccountSession(userDataPath: string): void {
  deleteSecureJson(sessionPath(userDataPath))
}
