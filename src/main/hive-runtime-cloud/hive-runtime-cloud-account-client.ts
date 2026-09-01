import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveRuntimeSession
} from '../../shared/hive-runtime-cloud'
import {
  normalizeConnectionIntent,
  type HiveRuntimeCloudConnectionIntent
} from './hive-runtime-cloud-connection-response'
import {
  normalizeRuntimeDirectoryEntry,
  normalizeRuntimeDirectoryPage
} from './hive-runtime-cloud-directory-response'
import { HiveRuntimeCloudHttpClient } from './hive-runtime-cloud-http-client'
import {
  normalizeRuntimeDisplayNamePatchResponse,
  type HiveRuntimeDisplayNamePatchResponse
} from './hive-runtime-cloud-display-name-response'
import { normalizeHiveRuntimeDisplayName } from '../../shared/hive-runtime-display-name'
import {
  normalizeRuntimeSession,
  normalizeRuntimeSessionPage
} from './hive-runtime-cloud-session-response'

export class HiveRuntimeCloudAccountClient extends HiveRuntimeCloudHttpClient {
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
  ): Promise<HiveRuntimeCloudConnectionIntent> {
    return normalizeConnectionIntent(
      await this.request(
        `/hive/v1/runtimes/${encodeURIComponent(runtimeRecordId)}/connection-intents`,
        request,
        { authorization: `Bearer ${accessToken}`, 'idempotency-key': idempotencyKey },
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
    if (parsed.runtimeRecordId !== runtimeRecordId) {
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
    managedWebSessionId: string,
    expectedControlVersion: number,
    accessToken: string,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<HiveRuntimeSession> {
    return normalizeRuntimeSession(
      await this.request(
        `/hive/v1/runtime-sessions/${encodeURIComponent(managedWebSessionId)}/revoke`,
        {
          protocolVersion: 'web-session-revoke/v1',
          expectedControlVersion,
          reasonCode: 'USER_REQUESTED'
        },
        { authorization: `Bearer ${accessToken}`, 'idempotency-key': idempotencyKey },
        202,
        signal
      )
    )
  }
}
