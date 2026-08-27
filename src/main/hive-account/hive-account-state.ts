import type { HiveAccountErrorCode, HiveAccountState } from '../../shared/hive-account'
import { HiveAccountRequestError } from './hive-account-client'
import type { HiveAccountSession } from './hive-account-session-store'

export function signedOutState(): HiveAccountState {
  return { configured: true, status: 'signed-out', persistence: 'encrypted' }
}

export function stateFromSession(session: HiveAccountSession): HiveAccountState {
  return {
    configured: true,
    status: 'signed-in',
    persistence: session.sessionProfile === 'TEMPORARY' ? 'none' : 'encrypted',
    account: session.account,
    authorityId: session.authorityId,
    deviceLabel: session.deviceLabel,
    expiresAt: session.expiresAt,
    sessionExpiresAt: session.sessionExpiresAt,
    sessionProfile: session.sessionProfile,
    ...(session.sessionExpiresAt <= Date.now() ? { errorCode: 'session_expired' as const } : {})
  }
}

export function errorState(errorCode: HiveAccountErrorCode): HiveAccountState {
  return { configured: true, status: 'error', persistence: 'none', errorCode }
}

export function classifyHiveAccountError(error: unknown): HiveAccountErrorCode {
  if (error instanceof HiveAccountRequestError) {
    if (error.status === 401 || error.status === 403) {
      return 'session_rejected'
    }
    if (error.status >= 500) {
      return 'server_unavailable'
    }
    return 'authorization_failed'
  }
  if (error instanceof Error) {
    if (error.message === 'hive_account_authorization_cancelled') {
      return 'authorization_cancelled'
    }
    if (error.message === 'hive_account_authorization_timeout') {
      return 'authorization_timeout'
    }
    if (error.name === 'AbortError' || error instanceof TypeError) {
      return 'network_unavailable'
    }
  }
  return 'authorization_failed'
}
