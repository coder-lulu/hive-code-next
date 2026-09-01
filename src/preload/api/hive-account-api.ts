import type {
  HiveAccountLoginCapabilities,
  HiveAccountRefreshResult,
  HiveAccountSmsChallenge,
  HiveAccountSmsSignInOptions,
  HiveAccountSmsVerifyOptions,
  HiveAccountSignInOptions,
  HiveAccountSignInResult,
  HiveAccountSignOutResult,
  HiveAccountState,
  HiveAccountSecurity,
  HiveAccountSecurityChallenge
} from '../../shared/hive-account'

export type HiveAccountApi = {
  getLoginCapabilities: () => Promise<HiveAccountLoginCapabilities>
  getState: () => Promise<HiveAccountState>
  signIn: (options: HiveAccountSignInOptions) => Promise<HiveAccountSignInResult>
  startSmsSignIn?: (options: HiveAccountSmsSignInOptions) => Promise<HiveAccountSmsChallenge>
  cancelSmsSignIn?: () => Promise<void>
  completeSmsSignIn?: (options: HiveAccountSmsVerifyOptions) => Promise<HiveAccountSignInResult>
  refresh: () => Promise<HiveAccountRefreshResult>
  signOut: () => Promise<HiveAccountSignOutResult>
  accountSecurity?: () => Promise<HiveAccountSecurity>
  setPassword?: (newPassword: string) => Promise<void>
  startPasswordReset?: (phoneNumber: string) => Promise<HiveAccountSecurityChallenge>
  verifyPasswordReset?: (challengeId: string, bindingId: string, smsCode: string, newPassword: string) => Promise<void>
  startPhoneBinding?: (phoneNumber: string) => Promise<HiveAccountSecurityChallenge>
  verifyPhoneBinding?: (challengeId: string, bindingId: string, smsCode: string) => Promise<void>
  onStateChanged: (callback: (state: HiveAccountState) => void) => () => void
}
