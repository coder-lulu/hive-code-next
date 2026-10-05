import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveRuntimeSession,
  HiveRuntimeSessionRevocation
} from '../../shared/hive-runtime-cloud'
import {
  normalizeRuntimeDirectoryEntry,
  normalizeRuntimeDirectoryPage
} from './hive-runtime-cloud-directory-response'
import { HiveRuntimeCloudHttpClient } from './hive-runtime-cloud-http-client'
import { hiveAgentLocalIdentitySchema } from './hive-agent-local-identity'
import {
  normalizeRuntimeDisplayNamePatchResponse,
  type HiveRuntimeDisplayNamePatchResponse
} from './hive-runtime-cloud-display-name-response'
import { normalizeHiveRuntimeDisplayName } from '../../shared/hive-runtime-display-name'
import {
  HiveAccountRelayIntentRequestSchema,
  parseHiveAccountRelayIntent
} from '../../shared/hive-account-relay-material'
import {
  normalizeRuntimeSessionRevocation,
  normalizeRuntimeSessionPage
} from './hive-runtime-cloud-session-response'

export class HiveRuntimeCloudAccountClient extends HiveRuntimeCloudHttpClient {
  async getCurrentIdentity(accessToken: string, signal?: AbortSignal) {
    if (signal?.aborted || !accessToken || accessToken.length > 8192 || /\s/.test(accessToken)) {
      throw new Error('hive_agent_identity_unavailable')
    }
    const response = await this.get('/hive/v1/ai/identity', accessToken, signal)
    return Object.freeze(hiveAgentLocalIdentitySchema.parse(response.value))
  }

  async listOwnedRuntimes(
    accessToken: string,
    cursor: string | null,
    limit: number,
    signal?: AbortSignal
  ): Promise<{ items: readonly HiveAccountRuntimeDirectoryEntry[]; nextCursor: string | null }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('invalid_hive_runtime_cloud_directory_limit')
    }
    const parameters = new URLSearchParams({ limit: String(limit) })
    if (cursor) {
      parameters.set('cursor', cursor)
    }
    const response = await this.get(`/hive/v1/runtimes?${parameters}`, accessToken, signal)
    return { items: normalizeRuntimeDirectoryPage(response.value), nextCursor: response.nextCursor }
  }

  async getOwnedRuntime(
    runtimeRecordId: string,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<HiveAccountRuntimeDirectoryEntry> {
    const response = await this.get(
      `/hive/v1/runtimes/${encodeURIComponent(runtimeRecordId)}`,
      accessToken,
      signal
    )
    return normalizeRuntimeDirectoryEntry(response.value)
  }

  async createConnectionIntent(
    runtimeRecordId: string,
    request: Record<string, unknown>,
    accessToken: string,
    idempotencyKey: string,
    signal?: AbortSignal
  ) {
    const body = HiveAccountRelayIntentRequestSchema.parse(request)
    if (body.idempotencyKey !== idempotencyKey) {
      throw new Error('Relay intent idempotency mismatch')
    }
    return parseHiveAccountRelayIntent(
      await this.request(
        `/hive/v1/runtimes/${encodeURIComponent(runtimeRecordId)}/connection-intents`,
        body,
        { authorization: `Bearer ${accessToken}` },
        201,
        signal
      )
    )
  }

  async updateOwnedRuntimeDisplayName(
    runtimeRecordId: string,
    cloudDisplayName: string | null,
    expectedCloudDisplayNameVersion: number,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<HiveRuntimeDisplayNamePatchResponse> {
    const normalizedName =
      cloudDisplayName === null ? null : normalizeHiveRuntimeDisplayName(cloudDisplayName)
    if (
      !Number.isSafeInteger(expectedCloudDisplayNameVersion) ||
      expectedCloudDisplayNameVersion < 1
    ) {
      throw new Error('invalid_hive_runtime_cloud_display_name_version')
    }
    const response = await this.patch(
      `/hive/v1/runtimes/${encodeURIComponent(runtimeRecordId)}`,
      {
        cloudDisplayName: normalizedName,
        expectedCloudDisplayNameVersion
      },
      accessToken,
      signal
    )
    const parsed = normalizeRuntimeDisplayNamePatchResponse(response)
    if (
      parsed.runtimeRecordId !== runtimeRecordId ||
      parsed.cloudDisplayName !== normalizedName ||
      parsed.cloudDisplayNameVersion < expectedCloudDisplayNameVersion
    ) {
      throw new Error('invalid_hive_runtime_cloud_display_name_response')
    }
    return parsed
  }

  async listRuntimeSessions(
    accessToken: string,
    cursor: string | null,
    limit: number,
    signal?: AbortSignal
  ): Promise<{ items: readonly HiveRuntimeSession[]; nextCursor: string | null }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('invalid_hive_runtime_cloud_session_limit')
    }
    const parameters = new URLSearchParams({ limit: String(limit) })
    if (cursor) {
      parameters.set('cursor', cursor)
    }
    const response = await this.get(`/hive/v1/runtime-sessions?${parameters}`, accessToken, signal)
    return normalizeRuntimeSessionPage(response.value)
  }

  async revokeRuntimeSession(
    managedSessionId: string,
    expectedResourceVersion: number,
    accessToken: string,
    operationId: string,
    signal?: AbortSignal
  ): Promise<HiveRuntimeSessionRevocation> {
    return normalizeRuntimeSessionRevocation(
      await this.request(
        `/hive/v1/runtime-sessions/${encodeURIComponent(managedSessionId)}/revoke`,
        {
          protocolVersion: 'account-runtime-session-revoke/v2',
          operationId,
          expectedResourceVersion
        },
        { authorization: `Bearer ${accessToken}` },
        202,
        signal
      ),
      operationId
    )
  }
}
