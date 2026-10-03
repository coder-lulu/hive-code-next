import {
  AI_BENEFITS_MAXIMUM_RESPONSE_BYTES,
  parseAiAccount,
  parseAiBalance,
  parseAiBenefits,
  type HiveAiBenefitsSnapshot,
  type HiveAiAccountSnapshot
} from '../../shared/hive-ai-account'
import {
  parseAiModelCandidates,
  type HiveAiModelCandidatesSnapshot
} from '../../shared/hive-ai-model-candidates'
import type { getHiveAccountConfig } from '../hive-account/hive-account-config'
import { HiveRuntimeCloudHttpClient } from './hive-runtime-cloud-http-client'
import { HiveAiCloudOperation, type AiAuthorizationSource } from './hive-ai-cloud-operation'

export class HiveAiAccountClient extends HiveRuntimeCloudHttpClient {
  async activate(token: string, signal: AbortSignal) {
    return parseAiAccount(
      await this.request(
        '/hive/v1/ai/account/activate',
        undefined,
        { authorization: `Bearer ${token}` },
        200,
        signal
      )
    )
  }
  async account(token: string, signal: AbortSignal) {
    return parseAiAccount((await this.get('/hive/v1/ai/account', token, signal)).value)
  }

  async balance(token: string, signal: AbortSignal) {
    return parseAiBalance((await this.get('/hive/v1/ai/balance', token, signal)).value)
  }

  async benefits(token: string, signal: AbortSignal) {
    return parseAiBenefits(
      (await this.get('/hive/v1/ai/benefits', token, signal, AI_BENEFITS_MAXIMUM_RESPONSE_BYTES))
        .value
    )
  }

  async modelCandidates(token: string, signal: AbortSignal) {
    return parseAiModelCandidates(
      (await this.get('/hive/v1/ai/model-candidates', token, signal)).value
    )
  }
}

export class HiveAiAccountReader {
  private readonly account: HiveAiCloudOperation<HiveAiAccountSnapshot>
  private readonly models: HiveAiCloudOperation<HiveAiModelCandidatesSnapshot>
  private readonly benefits: HiveAiCloudOperation<HiveAiBenefitsSnapshot>
  private readonly activation: HiveAiCloudOperation<
    Pick<HiveAiAccountSnapshot, 'accountId' | 'account'>
  >

  constructor(
    source: AiAuthorizationSource,
    getConfig: typeof getHiveAccountConfig,
    createClient: (
      origin: string
    ) => Pick<
      HiveAiAccountClient,
      'activate' | 'account' | 'balance' | 'benefits' | 'modelCandidates'
    > = (origin) => new HiveAiAccountClient(origin)
  ) {
    this.activation = new HiveAiCloudOperation(source, getConfig, async (origin, auth, signal) => ({
      accountId: auth.accountId,
      account: await createClient(origin).activate(auth.accessToken, signal)
    }))
    this.account = new HiveAiCloudOperation(
      source,
      getConfig,
      async (origin, auth, signal, assertCurrent) => {
        const client = createClient(origin)
        const account = await client.account(auth.accessToken, signal)
        assertCurrent()
        const balance =
          account.status === 'ACTIVE' ? await client.balance(auth.accessToken, signal) : null
        return { accountId: auth.accountId, account, balance }
      }
    )
    this.models = new HiveAiCloudOperation(source, getConfig, async (origin, auth, signal) => ({
      accountId: auth.accountId,
      catalog: await createClient(origin).modelCandidates(auth.accessToken, signal)
    }))
    this.benefits = new HiveAiCloudOperation(
      source,
      getConfig,
      async (origin, auth, signal, assertCurrent) => {
        const client = createClient(origin)
        const account = await client.account(auth.accessToken, signal)
        assertCurrent()
        const benefits =
          account.status === 'ACTIVE' ? await client.benefits(auth.accessToken, signal) : null
        return { accountId: auth.accountId, account, benefits }
      }
    )
  }

  read() {
    return this.account.run()
  }
  activate() {
    return this.activation.run()
  }
  readModelCandidates() {
    return this.models.run()
  }

  readBenefits() {
    return this.benefits.run()
  }
}
