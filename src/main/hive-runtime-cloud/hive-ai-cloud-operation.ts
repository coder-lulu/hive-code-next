import type {
  HiveAccountPublication,
  HiveRuntimeCloudAuthorization
} from '../hive-account/hive-account-publication'
import type { getHiveAccountConfig } from '../hive-account/hive-account-config'

export type AiAuthorizationSource = Pick<
  HiveAccountPublication,
  'getRuntimeCloudAuthorization' | 'subscribeRuntimeCloudAuthorization'
>
const unavailable = () => new Error('hive_ai_account_unavailable')

export class HiveAiCloudOperation<T> {
  private pending: {
    authorization: HiveRuntimeCloudAuthorization
    result: Promise<T>
  } | null = null

  constructor(
    private readonly source: AiAuthorizationSource,
    private readonly getConfig: typeof getHiveAccountConfig,
    private readonly operation: (
      origin: string,
      authorization: HiveRuntimeCloudAuthorization,
      signal: AbortSignal,
      assertCurrent: () => void
    ) => Promise<T>,
    private readonly lifetime?: AbortSignal
  ) {}

  run(): Promise<T> {
    const authorization = this.source.getRuntimeCloudAuthorization()
    if (!authorization || authorization.sessionExpiresAt <= Date.now()) {
      return Promise.reject(unavailable())
    }
    if (this.pending && this.sameSession(this.pending.authorization, authorization)) {
      return this.pending.result
    }
    const result = this.load(authorization)
    const entry = { authorization, result }
    this.pending = entry
    void result
      .finally(() => {
        if (this.pending === entry) {
          this.pending = null
        }
      })
      .catch(() => undefined)
    return result
  }

  private async load(authorization: HiveRuntimeCloudAuthorization): Promise<T> {
    if (this.lifetime?.aborted) {
      throw unavailable()
    }
    const configured = this.getConfig()
    if (!configured.configured) {
      throw unavailable()
    }
    const controller = new AbortController()
    const stop = () => controller.abort()
    this.lifetime?.addEventListener('abort', stop, { once: true })
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(unavailable()), { once: true })
    })
    const unsubscribe = this.source.subscribeRuntimeCloudAuthorization(() => controller.abort())
    const deadline = setTimeout(() => controller.abort(), 15_000)
    try {
      const assertCurrent = () => this.assertCurrent(authorization, controller.signal)
      assertCurrent()
      const value = await Promise.race([
        this.operation(
          configured.config.apiBaseUrl,
          authorization,
          controller.signal,
          assertCurrent
        ),
        cancelled
      ])
      assertCurrent()
      return value
    } catch {
      throw unavailable()
    } finally {
      clearTimeout(deadline)
      unsubscribe()
      this.lifetime?.removeEventListener('abort', stop)
    }
  }

  private assertCurrent(before: HiveRuntimeCloudAuthorization, signal: AbortSignal): void {
    const current = this.source.getRuntimeCloudAuthorization()
    if (
      signal.aborted ||
      !current ||
      current.sessionExpiresAt <= Date.now() ||
      !this.sameSession(before, current)
    ) {
      throw unavailable()
    }
  }

  private sameSession(
    before: HiveRuntimeCloudAuthorization,
    after: HiveRuntimeCloudAuthorization
  ): boolean {
    return (
      before.accountId === after.accountId &&
      before.authorityId === after.authorityId &&
      before.sessionGeneration === after.sessionGeneration &&
      before.accessToken === after.accessToken
    )
  }
}
