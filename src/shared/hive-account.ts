export type HiveAccountPersistence = 'none' | 'encrypted'
export const HIVE_ACCOUNT_STATE_CHANGED_CHANNEL = 'hiveAccount:stateChanged'
export type HiveAccountSessionProfile = 'TEMPORARY' | 'TRUSTED' | 'LEGACY'
export type HiveAccountSignInOptions = {
  sessionProfile: Exclude<HiveAccountSessionProfile, 'LEGACY'>
}

export type HiveAccountErrorCode =
  | 'secure_storage_unavailable'
  | 'credential_unreadable'
  | 'network_unavailable'
  | 'authorization_cancelled'
  | 'authorization_timeout'
  | 'authorization_failed'
  | 'session_expired'
  | 'session_rejected'
  | 'server_unavailable'

export type HiveAccountSummary = {
  accountId: string
  displayName: string
}

export type HiveAccountState = {
  configured: boolean
  status: 'unconfigured' | 'signed-out' | 'signed-in' | 'error'
  persistence: HiveAccountPersistence
  account?: HiveAccountSummary
  authorityId?: string
  deviceLabel?: string
  expiresAt?: number
  sessionExpiresAt?: number
  sessionProfile?: HiveAccountSessionProfile
  errorCode?: HiveAccountErrorCode
  setupMessage?: string
}

export type HiveAccountSignInResult =
  | { status: 'signed-in'; state: HiveAccountState }
  | { status: 'cancelled' | 'unconfigured' | 'failed'; state: HiveAccountState }

export type HiveAccountRefreshResult =
  | { status: 'refreshed'; state: HiveAccountState }
  | { status: 'signed-out' | 'unconfigured' | 'failed'; state: HiveAccountState }

export type HiveAccountSignOutResult = {
  status: 'remote-and-local' | 'local-only' | 'already-signed-out'
  state: HiveAccountState
}
