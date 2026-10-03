import {
  activateMobileAiAccount,
  readMobileAiAccount,
  readMobileAiBenefits,
  readMobileAiModelCandidates
} from './mobile-ai-account-client'
import { useMobileAiCloudRead } from './use-mobile-ai-cloud-read'

export function useMobileAiAccount() {
  return useMobileAiCloudRead(readMobileAiAccount, activateMobileAiAccount)
}

export function useMobileAiBenefits() {
  return useMobileAiCloudRead(readMobileAiBenefits)
}
export function useMobileAiModelCandidates() {
  return useMobileAiCloudRead(readMobileAiModelCandidates)
}
