import { parseHiveAiModelCatalog } from '../../shared/hive-ai-model-catalog'
import {
  HiveRuntimeCloudHttpClient,
  HiveRuntimeCloudRequestError,
  type HiveRuntimeCloudFetch
} from './hive-runtime-cloud-http-client'

export class HiveAiCatalogRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null
  ) {
    super('hive_ai_catalog_request_failed')
  }
}
const errorCodes = new Set([
  'INVALID_REQUEST',
  'FORBIDDEN',
  'CONFLICT',
  'UNAVAILABLE',
  'CREDENTIAL_REJECTED'
])

export function requireHiveAiCloudOrigin(apiBaseUrl: string): string {
  let origin: URL
  try {
    origin = new URL(apiBaseUrl)
  } catch {
    throw new Error('hive_ai_invalid_origin')
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new Error('hive_ai_invalid_origin')
  }
  return origin.origin
}

/** Account discovery with explicit credential preparation; secrets stay in the main process. */
export class HiveAiCatalogClient extends HiveRuntimeCloudHttpClient {
  constructor(apiBaseUrl: string, fetchImpl?: HiveRuntimeCloudFetch) {
    super(requireHiveAiCloudOrigin(apiBaseUrl), fetchImpl)
  }
  async catalog(input: { accessToken: string; signal?: AbortSignal; prepare?: boolean }) {
    if (input.signal?.aborted) {
      throw new Error('hive_ai_cancelled')
    }
    if (!input.accessToken || input.accessToken.length > 8192 || /\s/.test(input.accessToken)) {
      throw new Error('hive_ai_invalid_identity')
    }
    try {
      if (input.prepare) {
        const result = await this.request(
          '/hive/v1/ai/models/prepare',
          undefined,
          { authorization: `Bearer ${input.accessToken}` },
          200,
          input.signal
        )
        if (
          !result ||
          typeof result !== 'object' ||
          (result as { prepared?: unknown }).prepared !== true
        ) {
          throw new Error('hive_ai_preparation_unconfirmed')
        }
      }
      return parseHiveAiModelCatalog(
        (await this.get('/hive/v1/ai/models', input.accessToken, input.signal)).value
      )
    } catch (error) {
      if (error instanceof HiveRuntimeCloudRequestError) {
        throw new HiveAiCatalogRequestError(
          error.status,
          error.category !== null && errorCodes.has(error.category) ? error.category : null
        )
      }
      throw new Error('hive_ai_catalog_unavailable')
    }
  }
}
