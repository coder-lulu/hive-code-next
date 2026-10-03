import {
  parseAiAccount,
  parseAiBalance,
  parseAiBenefits,
  type HiveAiBenefitsSnapshot,
  type HiveAiAccountSnapshot
} from '../../../src/shared/hive-ai-account'
import {
  parseAiModelCandidates,
  type HiveAiModelCandidatesSnapshot
} from '../../../src/shared/hive-ai-model-candidates'
import type { MobileSession } from '../auth/mobile-sms-session'
import { runMobileAiCloud } from './mobile-ai-cloud-operation'

export function activateMobileAiAccount(
  session: MobileSession,
  signal: AbortSignal
): Promise<Pick<HiveAiAccountSnapshot, 'accountId' | 'account'>> {
  return runMobileAiCloud(
    session,
    signal,
    async (send) => ({
      accountId: session.account.accountId,
      account: parseAiAccount(await send('/hive/v1/ai/account/activate'))
    }),
    'POST'
  )
}

export function readMobileAiAccount(
  session: MobileSession,
  signal: AbortSignal
): Promise<HiveAiAccountSnapshot> {
  return runMobileAiCloud(session, signal, async (get) => {
    const account = parseAiAccount(await get('/hive/v1/ai/account'))
    const balance =
      account.status === 'ACTIVE' ? parseAiBalance(await get('/hive/v1/ai/balance')) : null
    return { accountId: session.account.accountId, account, balance }
  })
}

export function readMobileAiModelCandidates(
  session: MobileSession,
  signal: AbortSignal
): Promise<HiveAiModelCandidatesSnapshot> {
  return runMobileAiCloud(session, signal, async (get) => ({
    accountId: session.account.accountId,
    catalog: parseAiModelCandidates(await get('/hive/v1/ai/model-candidates'))
  }))
}

export function readMobileAiBenefits(
  session: MobileSession,
  signal: AbortSignal
): Promise<HiveAiBenefitsSnapshot> {
  return runMobileAiCloud(session, signal, async (get) => {
    const account = parseAiAccount(await get('/hive/v1/ai/account'))
    const benefits =
      account.status === 'ACTIVE' ? parseAiBenefits(await get('/hive/v1/ai/benefits')) : null
    return { accountId: session.account.accountId, account, benefits }
  })
}
