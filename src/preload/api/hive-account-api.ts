import type {
  HiveAccountRefreshResult,
  HiveAccountSignInResult,
  HiveAccountSignOutResult,
  HiveAccountState
} from '../../shared/hive-account'

export type HiveAccountApi = {
  getState: () => Promise<HiveAccountState>
  signIn: () => Promise<HiveAccountSignInResult>
  refresh: () => Promise<HiveAccountRefreshResult>
  signOut: () => Promise<HiveAccountSignOutResult>
}
