import {
  HiveRuntimeCloudHttpClient,
  HiveRuntimeCloudRequestError,
  type HiveRuntimeCloudFetch
} from './hive-runtime-cloud-http-client'
import { requireHiveAiCloudOrigin } from './hive-ai-catalog-client'
import {
  createHiveAiTextProof,
  HIVE_AI_TEXT_CONTROL_PATHS,
  type HiveAiTextControlOperation
} from './hive-ai-runtime-proof'
import {
  parseHiveAiTextControlRequest,
  parseHiveAiTextControlReply,
  type HiveAiRuntimeOwner,
  type HiveAiTextControlRequest
} from '../../shared/hive-ai-text-control'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
export class HiveAiTextControlRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null
  ) {
    super('hive_ai_control_request_failed')
  }
}
const codes = new Set([
  'INVALID_REQUEST',
  'GRANT_REJECTED',
  'FORBIDDEN',
  'CONFLICT',
  'UNAVAILABLE',
  'CREDENTIAL_REJECTED',
  'NOT_FOUND'
])
type ControlInput = {
  command: HiveAiTextControlRequest
  owner: HiveAiRuntimeOwner
  identity: HiveRuntimeCloudIdentity
  authorityId: string
  accessToken: string
  assertCurrent: () => void
  signal?: AbortSignal
}

/** Fixed Hive endpoints; no Gateway key, URL override, token refresh or POST retry. */
export class HiveAiTextControlClient extends HiveRuntimeCloudHttpClient {
  constructor(apiBaseUrl: string, fetchImpl?: HiveRuntimeCloudFetch) {
    super(requireHiveAiCloudOrigin(apiBaseUrl), fetchImpl)
  }
  status(input: ControlInput) {
    return this.control('status', input)
  }
  cancel(input: ControlInput) {
    return this.control('cancel', input)
  }
  private async control(operation: HiveAiTextControlOperation, input: ControlInput) {
    const { accessToken, assertCurrent, signal } = input
    if (signal?.aborted) {
      throw new Error('hive_ai_cancelled')
    }
    if (!accessToken || accessToken.length > 8192 || /\s/.test(accessToken)) {
      throw new Error('hive_ai_invalid_identity')
    }
    const command = parseHiveAiTextControlRequest(input.command)
    try {
      assertCurrent()
      const signed = createHiveAiTextProof({ ...input, command, operation })
      assertCurrent()
      if (signal?.aborted) {
        throw new Error('hive_ai_cancelled')
      }
      const value = await this.request(
        HIVE_AI_TEXT_CONTROL_PATHS[operation],
        JSON.parse(signed.body) as Record<string, unknown>,
        { Authorization: `Bearer ${accessToken}`, 'X-Hive-AI-Proof': signed.header },
        200,
        signal
      )
      assertCurrent()
      if (signal?.aborted) {
        throw new Error('hive_ai_cancelled')
      }
      return parseHiveAiTextControlReply(value, command.requestId)
    } catch (error) {
      if (error instanceof HiveRuntimeCloudRequestError) {
        throw new HiveAiTextControlRequestError(
          error.status,
          error.category !== null && codes.has(error.category) ? error.category : null
        )
      }
      throw new Error('hive_ai_control_unavailable')
    }
  }
}
