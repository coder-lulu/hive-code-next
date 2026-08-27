import type {
  HiveAccountRefreshResult,
  HiveAccountSmsChallenge,
  HiveAccountSmsSignInOptions,
  HiveAccountSmsVerifyOptions,
  HiveAccountSignInOptions,
  HiveAccountSignInResult,
  HiveAccountSignOutResult,
  HiveAccountState
} from '../../shared/hive-account'

export type HiveAccountApi = {
  getState: () => Promise<HiveAccountState>
  signIn: (options: HiveAccountSignInOptions) => Promise<HiveAccountSignInResult>
  startSmsSignIn?: (options: HiveAccountSmsSignInOptions) => Promise<HiveAccountSmsChallenge>
  completeSmsSignIn?: (options: HiveAccountSmsVerifyOptions) => Promise<HiveAccountSignInResult>
  refresh: () => Promise<HiveAccountRefreshResult>
  signOut: () => Promise<HiveAccountSignOutResult>
  onStateChanged: (callback: (state: HiveAccountState) => void) => () => void
}
