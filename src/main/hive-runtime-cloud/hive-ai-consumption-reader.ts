import {
  consumptionPath,
  parseConsumptionPage,
  parseConsumptionQuery,
  type ConsumptionQuery,
  type HiveAiConsumptionSnapshot
} from '../../shared/hive-ai-consumption'
import type { getHiveAccountConfig } from '../hive-account/hive-account-config'
import { HiveAiCloudOperation, type AiAuthorizationSource } from './hive-ai-cloud-operation'
import { HiveRuntimeCloudHttpClient } from './hive-runtime-cloud-http-client'

export class HiveAiConsumptionClient extends HiveRuntimeCloudHttpClient {
  async history(token: string, value: ConsumptionQuery, signal: AbortSignal) {
    const query = parseConsumptionQuery(value)
    return parseConsumptionPage(
      (await this.get(consumptionPath(query), token, signal)).value,
      query
    )
  }
}

export class HiveAiConsumptionReader {
  private pending: AbortController | undefined
  constructor(
    private readonly source: AiAuthorizationSource,
    private readonly getConfig: typeof getHiveAccountConfig,
    private readonly createClient: (origin: string) => Pick<HiveAiConsumptionClient, 'history'> = (
      origin
    ) => new HiveAiConsumptionClient(origin)
  ) {}

  read(value: ConsumptionQuery): Promise<HiveAiConsumptionSnapshot> {
    const query = parseConsumptionQuery(value)
    this.pending?.abort()
    const controller = new AbortController()
    this.pending = controller
    const operation = new HiveAiCloudOperation(
      this.source,
      this.getConfig,
      async (origin, auth, signal) => ({
        accountId: auth.accountId,
        history: await this.createClient(origin).history(auth.accessToken, query, signal)
      }),
      controller.signal
    )
    return operation.run().finally(() => {
      if (this.pending === controller) {
        this.pending = undefined
      }
    })
  }
}
