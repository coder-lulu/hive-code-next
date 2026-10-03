import type { HiveAiModelCandidatesSnapshot } from '../../shared/hive-ai-model-candidates'
import type { ConsumptionQuery, HiveAiConsumptionSnapshot } from '../../shared/hive-ai-consumption'
import type {
  HiveAiModelCatalogSnapshot,
  HiveAiModelSelection
} from '../../shared/hive-ai-model-catalog'
import type { HiveAiAccountSnapshot, HiveAiBenefitsSnapshot } from '../../shared/hive-ai-account'
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
  readAiConsumption: (query: ConsumptionQuery) => Promise<HiveAiConsumptionSnapshot>
  getLoginCapabilities: () => Promise<HiveAccountLoginCapabilities>
  getState: () => Promise<HiveAccountState>
  signIn: (options: HiveAccountSignInOptions) => Promise<HiveAccountSignInResult>
  startSmsSignIn?: (options: HiveAccountSmsSignInOptions) => Promise<HiveAccountSmsChallenge>
  cancelSmsSignIn?: () => Promise<void>
  completeSmsSignIn?: (options: HiveAccountSmsVerifyOptions) => Promise<HiveAccountSignInResult>
  refresh: () => Promise<HiveAccountRefreshResult>
  signOut: () => Promise<HiveAccountSignOutResult>
  readAiAccount: () => Promise<HiveAiAccountSnapshot>
  activateAiAccount: () => Promise<Pick<HiveAiAccountSnapshot, 'accountId' | 'account'>>
  readAiBenefits: () => Promise<HiveAiBenefitsSnapshot>
  readAiModelCandidates: () => Promise<HiveAiModelCandidatesSnapshot>
  readAiModels: () => Promise<HiveAiModelCatalogSnapshot>
  selectAiModel: (command: HiveAiModelSelection) => Promise<HiveAiModelCatalogSnapshot>
  accountSecurity?: () => Promise<HiveAccountSecurity>
  setPassword?: (newPassword: string) => Promise<void>
  startPasswordReset?: (phoneNumber: string) => Promise<HiveAccountSecurityChallenge>
  verifyPasswordReset?: (
    challengeId: string,
    bindingId: string,
    smsCode: string,
    newPassword: string
  ) => Promise<void>
  startPhoneBinding?: (phoneNumber: string) => Promise<HiveAccountSecurityChallenge>
  verifyPhoneBinding?: (challengeId: string, bindingId: string, smsCode: string) => Promise<void>
  onStateChanged: (callback: (state: HiveAccountState) => void) => () => void
}
