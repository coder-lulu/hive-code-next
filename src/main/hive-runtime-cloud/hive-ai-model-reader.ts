import {
  hiveAiModelSelectionCommandSchema,
  parseHiveAiModelCatalog,
  selectHiveAiModel,
  type HiveAiModelCatalogSnapshot,
  type HiveAiModelSelection
} from '../../shared/hive-ai-model-catalog'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { getHiveAccountConfig } from '../hive-account/hive-account-config'
import { HiveAiCatalogClient } from './hive-ai-catalog-client'
import { HiveAiCloudOperation, type AiAuthorizationSource } from './hive-ai-cloud-operation'

export type HiveAiModelResolution = Readonly<{
  selection: Readonly<HiveAiModelSelection>
  assertCurrent: () => void
}>

/** A login-scoped preference, always rechecked against a fresh owner-bound catalog. */
export class HiveAiModelReader {
  private selection: {
    accountId: string
    authorityId: string
    sessionGeneration: number
    origin: string
    value: HiveAiModelSelection
  } | null = null
  private epoch = 0
  private changing: { epoch: number; scope: string } | null = null
  private reading: HiveAiCloudOperation<HiveAiModelCatalogSnapshot>

  constructor(
    private readonly source: AiAuthorizationSource,
    private readonly getConfig: typeof getHiveAccountConfig,
    private readonly createClient: (origin: string) => Pick<HiveAiCatalogClient, 'catalog'> = (
      origin
    ) => new HiveAiCatalogClient(origin)
  ) {
    this.reading = this.createReading()
  }

  private createReading() {
    return new HiveAiCloudOperation(
      this.source,
      this.getConfig,
      async (origin, auth, signal, assertCurrent) => {
        const epoch = this.epoch
        const catalog = parseHiveAiModelCatalog(
          await this.createClient(origin).catalog({
            accessToken: auth.accessToken,
            signal,
            prepare: true
          })
        )
        assertCurrent()
        if (epoch !== this.epoch) {
          throw new Error('hive_ai_model_selection_changed')
        }
        const selected = this.selection
        if (
          selected &&
          (selected.accountId !== auth.accountId ||
            selected.authorityId !== auth.authorityId ||
            selected.sessionGeneration !== auth.sessionGeneration ||
            selected.origin !== origin ||
            selected.value.snapshotRevision !== catalog.snapshotRevision ||
            !catalog.models.some(
              (model) =>
                model.modelId === selected.value.modelId &&
                model.protocols.includes(selected.value.protocol)
            ))
        ) {
          this.selection = null
        }
        return {
          accountId: auth.accountId,
          catalog,
          selection: this.selection ? { ...this.selection.value } : null
        }
      }
    )
  }

  async read() {
    const epoch = this.epoch
    try {
      return await this.reading.run()
    } catch (error) {
      if (epoch === this.epoch) {
        this.selection = null
      }
      throw error
    }
  }

  async resolveForGeneration(command: unknown, accountId: string): Promise<HiveAiModelResolution> {
    const parsed = hiveAiModelSelectionCommandSchema.safeParse(command)
    if (!parsed.success) {
      throw new Error('hive_ai_invalid_model_selection')
    }
    const operation = new HiveAiCloudOperation(
      this.source,
      this.getConfig,
      async (origin, auth, signal, assertCurrent) => {
        const guard = () => {
          assertCurrent()
          const configured = this.getConfig()
          if (
            auth.accountId !== accountId ||
            !configured.configured ||
            configured.config.apiBaseUrl !== origin
          ) {
            throw new Error('hive_ai_account_unavailable')
          }
        }
        guard()
        const catalog = parseHiveAiModelCatalog(
          await this.createClient(origin).catalog({ accessToken: auth.accessToken, signal })
        )
        guard()
        const selection = selectHiveAiModel({
          catalog,
          modelId: parsed.data.modelId,
          protocol: parsed.data.protocol,
          expectedSnapshotRevision: parsed.data.snapshotRevision,
          generationState: null
        })
        return Object.freeze({ selection: Object.freeze(selection), assertCurrent: guard })
      }
    )
    return operation.run()
  }

  async select(command: unknown): Promise<HiveAiModelCatalogSnapshot> {
    const parsed = hiveAiModelSelectionCommandSchema.safeParse(command)
    if (!parsed.success) {
      throw new Error('hive_ai_invalid_model_selection')
    }
    const auth = this.source.getRuntimeCloudAuthorization()
    if (!auth || auth.sessionExpiresAt <= Date.now()) {
      throw new Error('hive_ai_account_unavailable')
    }
    const scope = JSON.stringify([auth.accountId, auth.authorityId, auth.sessionGeneration])
    if (this.changing?.scope === scope) {
      throw new Error('hive_ai_model_selection_busy')
    }
    const epoch = ++this.epoch
    this.changing = { epoch, scope }
    this.reading = this.createReading()
    this.selection = null
    const operation = new HiveAiCloudOperation(
      this.source,
      this.getConfig,
      async (origin, auth, signal, assertCurrent) => {
        const catalog = parseHiveAiModelCatalog(
          await this.createClient(origin).catalog({ accessToken: auth.accessToken, signal })
        )
        assertCurrent()
        if (epoch !== this.epoch) {
          throw new Error('hive_ai_model_selection_changed')
        }
        const selection = selectHiveAiModel({
          catalog,
          modelId: parsed.data.modelId,
          protocol: parsed.data.protocol,
          expectedSnapshotRevision: parsed.data.snapshotRevision,
          generationState: null
        })
        return {
          snapshot: { accountId: auth.accountId, catalog, selection: { ...selection } },
          commit: () => {
            assertCurrent()
            this.remember(auth, origin, selection)
          }
        }
      }
    )
    try {
      const result = await operation.run()
      if (epoch !== this.epoch) {
        throw new Error('hive_ai_model_selection_changed')
      }
      result.commit()
      this.epoch++
      this.reading = this.createReading()
      return result.snapshot
    } catch (error) {
      if (epoch === this.epoch) {
        this.selection = null
      }
      throw error
    } finally {
      if (this.changing?.epoch === epoch) {
        this.changing = null
      }
    }
  }

  private remember(
    auth: HiveRuntimeCloudAuthorization,
    origin: string,
    value: HiveAiModelSelection
  ) {
    this.selection = {
      accountId: auth.accountId,
      authorityId: auth.authorityId,
      sessionGeneration: auth.sessionGeneration,
      origin,
      value
    }
  }
}
