import { randomBytes } from 'node:crypto'
import type { HiveAccountSummary } from '../../shared/hive-account'
import type { HiveAccountConfig } from './hive-account-config'

const REQUEST_TIMEOUT_MS = 10_000
const MAXIMUM_RESPONSE_CHARACTERS = 65_536

export type NativeSessionResponse = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  account: HiveAccountSummary
  authorityId: string
}

export type CloudSessionEntry = {
  cloudSessionId: string
  securityVersion: number
  currentSession: boolean
}

export class HiveAccountRequestError extends Error {
  constructor(
    readonly status: number,
    readonly category: string | null,
    message = 'hive_account_request_failed'
  ) {
    super(message)
    this.name = 'HiveAccountRequestError'
  }
}

type FetchLike = typeof fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`invalid_hive_account_${field}`)
  }
  return value
}

function uuid(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)) {
    throw new Error(`invalid_hive_account_${field}`)
  }
  return result
}

function instant(value: unknown, field: string): number {
  const parsed = Date.parse(text(value, field))
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid_hive_account_${field}`)
  }
  return parsed
}

async function responseText(response: Response): Promise<string> {
  const body = await response.text()
  if (body.length > MAXIMUM_RESPONSE_CHARACTERS) {
    throw new Error('hive_account_response_too_large')
  }
  return body
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new Error('invalid_hive_account_response')
  }
}

async function requestJson(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers
      }
    })
    const body = await responseText(response)
    if (!response.ok) {
      let category: string | null = null
      try {
        const failure = parseJson(body)
        if (isRecord(failure)) {
          category =
            typeof failure.category === 'string'
              ? failure.category
              : typeof failure.code === 'string'
                ? failure.code
                : null
        }
      } catch {
        // Error bodies are intentionally optional and never copied to the UI.
      }
      throw new HiveAccountRequestError(response.status, category)
    }
    return parseJson(body)
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeSession(value: unknown): NativeSessionResponse {
  if (!isRecord(value) || !isRecord(value.account)) {
    throw new Error('invalid_hive_account_session_response')
  }
  const expiresAt = instant(value.expiresAt, 'expires_at')
  if (expiresAt <= Date.now()) {
    throw new Error('expired_hive_account_session_response')
  }
  return {
    accessToken: text(value.accessToken, 'access_token'),
    refreshToken: text(value.refreshToken, 'refresh_token'),
    expiresAt,
    account: {
      accountId: uuid(value.account.accountId, 'account_id'),
      displayName: text(value.account.displayName, 'display_name')
    },
    authorityId: text(value.authorityId, 'authority_id')
  }
}

export class HiveAccountClient {
  constructor(
    private readonly config: HiveAccountConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async discoverAuthorizationEndpoint(): Promise<string> {
    const discoveryUrl = `${this.config.identityIssuer}/.well-known/openid-configuration`
    const value = await requestJson(this.fetchImpl, discoveryUrl, { method: 'GET' })
    if (!isRecord(value) || value.issuer !== this.config.identityIssuer) {
      throw new Error('hive_account_oidc_issuer_mismatch')
    }
    const endpoint = new URL(text(value.authorization_endpoint, 'authorization_endpoint'))
    const issuer = new URL(this.config.identityIssuer)
    if (endpoint.origin !== issuer.origin || endpoint.protocol !== issuer.protocol) {
      throw new Error('hive_account_oidc_authorization_origin_mismatch')
    }
    return endpoint.toString()
  }

  async createDeviceAuthorization(args: {
    nonce: string
    devicePublicKey: string
    deviceLabel: string
    proof: string
  }): Promise<void> {
    const value = await requestJson(
      this.fetchImpl,
      `${this.config.apiBaseUrl}/hive/v1/auth/device-authorizations`,
      {
        method: 'POST',
        body: JSON.stringify({ ...args, clientId: this.config.clientId })
      }
    )
    if (
      !isRecord(value) ||
      value.contractRevision !== 'stage2a-device-authorization-v1' ||
      instant(value.expiresAt, 'device_authorization_expiry') <= Date.now()
    ) {
      throw new Error('invalid_hive_device_authorization_response')
    }
  }

  async exchangeSession(args: {
    authorizationCode: string
    codeVerifier: string
    redirectUri: string
    nonce: string
  }): Promise<NativeSessionResponse> {
    return normalizeSession(
      await requestJson(this.fetchImpl, `${this.config.apiBaseUrl}/hive/v1/auth/session-exchange`, {
        method: 'POST',
        body: JSON.stringify({ ...args, clientId: this.config.clientId })
      })
    )
  }

  async refreshSession(refreshToken: string): Promise<NativeSessionResponse> {
    return normalizeSession(
      await requestJson(this.fetchImpl, `${this.config.apiBaseUrl}/hive/v1/auth/session-refresh`, {
        method: 'POST',
        body: JSON.stringify({ refreshToken })
      })
    )
  }

  async listCloudSessions(accessToken: string): Promise<CloudSessionEntry[]> {
    const value = await requestJson(
      this.fetchImpl,
      `${this.config.apiBaseUrl}/hive/v1/cloud-sessions?limit=100`,
      { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } }
    )
    if (!isRecord(value) || !Array.isArray(value.items)) {
      throw new Error('invalid_hive_cloud_session_list')
    }
    return value.items.map((item) => {
      if (!isRecord(item)) {
        throw new Error('invalid_hive_cloud_session_entry')
      }
      if (
        typeof item.securityVersion !== 'number' ||
        !Number.isSafeInteger(item.securityVersion) ||
        typeof item.currentSession !== 'boolean'
      ) {
        throw new Error('invalid_hive_cloud_session_entry')
      }
      return {
        cloudSessionId: uuid(item.cloudSessionId, 'cloud_session_id'),
        securityVersion: item.securityVersion,
        currentSession: item.currentSession
      }
    })
  }

  async revokeSession(accessToken: string, session: CloudSessionEntry): Promise<void> {
    await requestJson(
      this.fetchImpl,
      `${this.config.apiBaseUrl}/hive/v1/cloud-sessions/${session.cloudSessionId}/revoke`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'idempotency-key': randomBytes(24).toString('base64url')
        },
        body: JSON.stringify({
          expectedSecurityVersion: session.securityVersion,
          reason: 'owner_sign_out'
        })
      }
    )
  }
}
