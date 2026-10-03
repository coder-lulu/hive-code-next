import {
  consumptionPath,
  parseConsumptionPage,
  parseConsumptionQuery,
  type ConsumptionQuery,
  type HiveAiConsumptionSnapshot
} from '../../../src/shared/hive-ai-consumption'
import type { MobileSession } from '../auth/mobile-sms-session'
import { runMobileAiCloud } from './mobile-ai-cloud-operation'

export function readMobileAiConsumption(
  session: MobileSession,
  value: ConsumptionQuery,
  signal: AbortSignal
): Promise<HiveAiConsumptionSnapshot> {
  const query = parseConsumptionQuery(value)
  return runMobileAiCloud(session, signal, async (get) => ({
    accountId: session.account.accountId,
    history: parseConsumptionPage(await get(consumptionPath(query)), query)
  }))
}
