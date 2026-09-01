export type HiveAccountPersistence = 'none' | 'encrypted'
export const HIVE_ACCOUNT_STATE_CHANGED_CHANNEL = 'hiveAccount:stateChanged'
export type HiveAccountSessionProfile = 'TEMPORARY' | 'TRUSTED' | 'LEGACY'
export type HiveAccountLoginProviderId = 'github' | 'wechat' | 'qq'
export type HiveAccountSignInOptions =
  | {
      sessionProfile: Exclude<HiveAccountSessionProfile, 'LEGACY'>
      providerId?: HiveAccountLoginProviderId
      intent?: never
    }
  | {
      sessionProfile: Exclude<HiveAccountSessionProfile, 'LEGACY'>
      intent: 'STEP_UP'
      providerId?: never
    }
export type HiveAccountLoginProvider = {
  id: HiveAccountLoginProviderId
  authorizationPath: string
}
export type HiveAccountLoginCapabilities = {
  contractRevision: 'hive-login-capabilities-v1'
  clientId: string
  defaultMethod: 'phone_sms'
  providers: HiveAccountLoginProvider[]
}
export type HiveAccountSmsSignInOptions = {
  phoneNumber: string
  sessionProfile: Exclude<HiveAccountSessionProfile, 'LEGACY'>
  locale?: 'zh-CN' | 'en-US'
  termsAccepted: true
}
export type HiveAccountSmsVerifyOptions = {
  challengeId: string
  smsCode: string
}
export type HiveAccountSmsChallenge = {
  challengeId: string
  expiresInSeconds: number
  resendAfterSeconds: number
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

export type HiveAccountSecurity = {
  accountId: string
  userName: string
  displayName: string
  phoneNumber: string | null
  phoneBound: boolean
}

export type HiveAccountSecurityChallenge = {
  challengeId: string
  bindingId: string
  expiresInSeconds: number
  resendAfterSeconds: number
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
