import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import { z } from 'zod'
import { parseHiveAiModelCatalog } from '../../shared/hive-ai-model-catalog'
import type { CurrentHiveRuntimeCloudLeaseContext } from './hive-runtime-cloud-lease-context'
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
  'GRANT_REJECTED',
  'FORBIDDEN',
  'CONFLICT',
  'STALE_REVISION',
  'UNAVAILABLE',
  'MODEL_DISABLED',
  'UNSUPPORTED_PROTOCOL',
  'CONFORMANCE_REQUIRED'
])

const path = '/hive/v1/ai/catalog'
const uuid = z.string().uuid()
const tupleSchema = z.strictObject({
  authorityGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  runtimeRecordId: uuid,
  runtimeInstanceId: uuid,
  bootId: uuid,
  heartbeatLeaseId: uuid,
  leaseEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  fencingEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})

/** Main-process only: reuses bounded HTTP transport, never refreshes credentials or retries. */
export class HiveAiCatalogClient extends HiveRuntimeCloudHttpClient {
  constructor(apiBaseUrl: string, fetchImpl?: HiveRuntimeCloudFetch) {
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
    super(origin.origin, fetchImpl)
  }

  async catalog(input: {
    accountId: string
    deviceId: string
    accessToken: string
    context: CurrentHiveRuntimeCloudLeaseContext
    signal?: AbortSignal
  }) {
    if (input.signal?.aborted) {
      throw new Error('hive_ai_cancelled')
    }
    let request: { runtime: z.infer<typeof tupleSchema> }
    let proofHeader: string
    try {
      const { context } = input
      if (
        !input.accessToken ||
        input.accessToken.length > 8192 ||
        /\s/.test(input.accessToken) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(context.authorityId) ||
        context.identity.runtimeInstanceId !== context.tuple.runtimeInstanceId
      ) {
        throw new Error('invalid_identity')
      }
      request = { runtime: tupleSchema.parse(context.tuple) }
      const owner = {
        accountId: uuid.parse(input.accountId),
        deviceId: uuid.parse(input.deviceId),
        runtimeRecordId: request.runtime.runtimeRecordId
      }
      const fields = {
        domain: 'hive-ai-synthetic-pop/v1',
        algorithm: 'Ed25519',
        authorityId: context.authorityId,
        method: 'POST',
        path,
        nonce: randomUUID(),
        issuedAt: new Date().toISOString(),
        bodySha256: createHash('sha256').update(JSON.stringify(request)).digest('hex')
      }
      const canonical = JSON.stringify(
        Object.fromEntries(
          Object.entries({ ...fields, ...owner }).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0
          )
        )
      )
      const signature = sign(
        null,
        Buffer.from(canonical),
        createPrivateKey({
          key: Buffer.from(context.identity.privateKeyPkcs8, 'base64'),
          format: 'der',
          type: 'pkcs8'
        })
      ).toString('base64url')
      proofHeader = Buffer.from(JSON.stringify({ ...fields, owner, signature })).toString(
        'base64url'
      )
    } catch {
      throw new Error('hive_ai_invalid_identity')
    }
    let response: unknown
    try {
      response = await this.request(
        path,
        request,
        {
          authorization: `Bearer ${input.accessToken}`,
          'X-Hive-AI-Proof': proofHeader
        },
        200,
        input.signal
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
    return parseHiveAiModelCatalog(response)
  }
}
